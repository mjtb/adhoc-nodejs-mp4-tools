// chapterrific.js — Copyright © 2016 Michael Trenholm-Boyle.
// Licensed under a permissive MIT License. Please refer to the LICENSE file in the repository root.
var fs = require('fs');
var path = require('path');
var util = require('util');
var child_process = require('child_process');
var xmldom = require('xmldom');
var format_argv = require('../shared/format_argv');

var argv1 = process.argv.length > 2 ? process.argv[2] : 'db.json';
if(argv1 == '--help') {
	console.log('Combines separate MP4 files into one with chapter markers for each file.');
	console.log('Requires ffmpeg, ffprobe, mp4box, and atomicparsley to be in your PATH.')
	console.log('syntax: node chapterrific.js (db.json)?');
	process.exit(0);
}
var dbfn = path.resolve(__dirname, argv1);
var _dbdir = path.dirname(dbfn);
var DB = JSON.parse(fs.readFileSync(dbfn));
if(!Array.isArray(DB)) {
	var t = DB;
	DB = [ t ];
}

// Helper functions for working with hh:mm:ss.sss timecode values.
function parse_hms(hms) {
	var re = /([0-9]{2}):([0-9]{2}):([0-9]{2}\.[0-9]+)/;
	var rx = re.exec(hms);
	var h = Number(rx[1]), m = Number(rx[2]), s = Number(rx[3]);
	return ((h * 60) + m) * 60 + s;
}
function format_hms(sec) {
	var ws = sec.toFixed(0);
	var h = Math.floor(ws / 3600).toFixed(0);
	var m = Math.floor((ws % 3600) / 60).toFixed(0);
	var s = (sec - h * 3600 - m * 60).toFixed(3);
	var dig = function(n) {
		if(n < 10) {
			return '0' + String(n);
		} else {
			return String(n);
		}
	};
	return dig(h) + ':' + dig(m) + ':' + dig(s);
}
for(var DBi = 0; DBi < DB.length; ++DBi) {
	var db = DB[DBi];
	// Compute the duration of each chapter using ffprobe.
	for(var i = 0; i < db.chapters.length; ++i) {
		if(!db.chapters[i].hasOwnProperty('duration')) {
			var fn =  db.chapters[i].hasOwnProperty('source') ? db.chapters[i].source : db.source.replace('${title}', db.chapters[i].title);
			var args = [ '-i', path.resolve(_dbdir, fn) ];
			console.log('ffprobe ' + format_argv(args));
			var rv = child_process.spawnSync('ffprobe', args, { stdio: [ 'ignore', 'pipe', 'pipe'], encoding: 'utf8'});
			if(!rv || rv.error || rv.status) {
				console.log(rv);
				process.exit(1);
			}
			var re = /^\s*Duration:\s+([0-9:.]+),/m;
			var rx = re.exec(rv.stderr);
			db.chapters[i].duration = parse_hms(rx[1]);
		}
	}

	// Combine the individual MP4 files into one (if necessary) using ffmpeg.
	if(!db.hasOwnProperty('destination')) {
		var concat = '';
		for(var i = 0; i < db.chapters.length; ++i) {
			var fn =  path.resolve(_dbdir, db.chapters[i].hasOwnProperty('source') ? db.chapters[i].source : db.source.replace('${title}', db.chapters[i].title));
			concat += `file '${fn}'\n`;
		}
		var filelist = path.join(_dbdir, 'filelist.txt');
		for(var i = 1; i < 1000; ++i) {
			try {
				var st = fs.statSync(filelist);
				if(!st) {
					break;
				}
				filelist = path.join(_dbdir, `filelist-${i}.txt`);
			} catch(e) {
				break;
			}
		}
		fs.writeFileSync(filelist, concat);
		var dst = db.album + '.mp4';
		var args = [ '-f', 'concat', '-i', filelist, '-codec', 'copy', '-movflags', '+faststart', path.join(_dbdir, dst) ];
		console.log('ffmpeg ' + format_argv(args));
		var rv = child_process.spawnSync('ffmpeg', args, { stdio: [ 'ignore', 'pipe', 'pipe'], encoding: 'utf8'});
		fs.unlinkSync(filelist);
		if(!rv || rv.error || rv.status) {
			console.log(concat);
			console.log(rv);
			process.exit(1);
		}
		db.destination = dst;
	}

	// Determine the starting keyframes of each chapter to be using ffprobe.
	var read_intervals = [];
	for(var i = 0; i < db.chapters.length; ++i) {
		if(!db.chapters[i].hasOwnProperty('start')) {
			if(i == 0) {
				db.chapters[i].start = 0;
			} else {
				var start = 0;
				for(var j = 0; j < i; ++j) {
					start += db.chapters[j].duration;
				}
				read_intervals.push(Math.max(0, start - 20).toFixed(3) + '%+40');
			}
		}
	}
	if(read_intervals.length > 0) {
		var args = [ '-i', path.resolve(_dbdir, db.destination), '-print_format', 'csv', '-show_frames', '-read_intervals', read_intervals.join(',') ];
		console.log('ffprobe ' + format_argv(args));
		var rv = child_process.spawnSync('ffprobe', args, { stdio: [ 'ignore', 'pipe', 'pipe'], encoding: 'utf8'});
		if(!rv || rv.error || rv.status) {
			console.log(rv);
			process.exit(1);
		}
		var re = /^frame,video,.,1,\d+,([0-9.]+),/gm;
		var keyframes = [];
		var input = String(rv.stdout);
		for(var rm = re.exec(input); rm !== null; rm = re.exec(input)) {
			keyframes.push(Number(rm[1]));
		}
		for(var i = 1; i < db.chapters.length; ++i) {
			if(!db.chapters[i].hasOwnProperty('start')) {
				var start = 0;
				for(var j = 0; j < i; ++j) {
					start += db.chapters[j].duration;
				}
				var index = 0;
				var delta = Math.abs(keyframes[index] - start);
				for(var j = 1; j < keyframes.length; ++j) {
					var d = Math.abs(keyframes[j] - start);
					if(d < delta) {
						index = j;
						delta = d;
					} else {
						break;
					}
				}
				db.chapters[i].start = keyframes[index];
			}
		}
	}

	// Add the chapter track using mp4box.
	if(!db.hasOwnProperty('chaptered') || !db.chaptered) {
		var impl = new xmldom.DOMImplementation();
		var doc = impl.createDocument(null, 'TextStream', null);
		doc.documentElement.setAttribute('version', '1.1');
		var tsh = doc.documentElement.appendChild(doc.createElement('TextStreamHeader'));
		tsh.setAttribute('width', '480');
		tsh.setAttribute('height', '368');
		tsh.setAttribute('layer', '0');
		tsh.setAttribute('translation_x', '0');
		tsh.setAttribute('translation_y', '0');
		var tsd = tsh.appendChild(doc.createElement('TextSampleDescription'));
		tsd.setAttribute('horizontalJustification', 'center');
		tsd.setAttribute('verticalJustification', 'bottom');
		tsd.setAttribute('backColor', '0 0 0 0');
		tsd.setAttribute('verticalText', 'no');
		tsd.setAttribute('fillTextRegion', 'no');
		tsd.setAttribute('continuousKaraoke', 'no');
		tsd.setAttribute('scroll', 'None');
		var ft = tsd.appendChild(doc.createElement('FontTable'));
		var fte = ft.appendChild(doc.createElement('FontTableEntry'));
		fte.setAttribute('fontName', 'Arial');
		fte.setAttribute('fontID', '1');
		var tb = tsd.appendChild(doc.createElement('TextBox'));
		tb.setAttribute('top', '0');
		tb.setAttribute('left', '0');
		tb.setAttribute('bottom', '368');
		tb.setAttribute('right', '480');
		var sty = tsd.appendChild(doc.createElement('Style'));
		sty.setAttribute('styles', 'Normal');
		sty.setAttribute('fontID', '1');
		sty.setAttribute('fontSize', '32');
		sty.setAttribute('color', 'ff ff ff ff');
		for(var i = 0; i < db.chapters.length; ++i) {
			var ts = doc.documentElement.appendChild(doc.createElement('TextSample'));
			ts.setAttribute('sampleTime', format_hms(db.chapters[i].start));
			ts.textContent = db.chapters[i].name;
		}
		var ser = new xmldom.XMLSerializer();
		var chapttxt = path.join(_dbdir, 'chapters.ttxt');
		for(var i = 1; i < 1000; ++i) {
			try {
				var st = fs.statSync(chapttxt);
				if(!st) {
					break;
				}
			} catch(err) {
				break;
			}
			chapttxt = path.join(_dbdir, `chapters-${i}.ttxt`);
		}
		fs.writeFileSync(chapttxt, ser.serializeToString(doc));
		var dst = path.resolve(_dbdir, db.destination);
		var tvar = String((new Date()).valueOf());
		var tmp4 = path.join(_dbdir, `tmp-${tvar}.mp4`);
		var args = [ '-ipod', '-add', `${dst}#video`, '-add', `${dst}#audio`, '-add', `${chapttxt}:chap`, tmp4];
		console.log('mp4box ' + format_argv(args));
		var rv = child_process.spawnSync('mp4box', args, { stdio: [ 'ignore', 'pipe', 'pipe'], encoding: 'utf8' });
		fs.unlinkSync(chapttxt);
		if(!rv || rv.error || rv.status) {
			console.log(rv);
			process.exit(1);
		}
		var tmp42 = path.join(_dbdir, `tmp-${tvar}-orig.mp4`);
		fs.renameSync(dst, tmp42);
		fs.renameSync(tmp4, dst);
		fs.unlinkSync(tmp42);
		db.chaptered = true;
	}

	// Add metadata with Atomic Parsley.
	if(!db.hasOwnProperty('finished') || !db.finished) {
		var dst = path.resolve(_dbdir, db.destination);
		var args = [ dst, '--overWrite', '--title', db.album ];
		if(db['artist']) {
			args.push('--artist');
			args.push(db.artist);
		}
		if(db['artwork']) {
			args.push('--artwork');
			args.push(path.resolve(_dbdir, db.artwork));
		}
		if(db['tvsh']) {
			args.push('--TVShowName');
			args.push(db.tvsh);
		}
		if(db['tvsn']) {
			args.push('--TVSeasonNum');
			args.push(db.tvsn);
		}
		if(db['tven']) {
			args.push('--TVEpisodeNum');
			args.push(db.tven);
		}
		if(db['tves']) {
			args.push('--TVEpisode');
			args.push(db.tves);
		}
		console.log('atomicparsley ' + format_argv(args));
		var rv = child_process.spawnSync('atomicparsley', args, { stdio: [ 'ignore', 'pipe', 'pipe'], encoding: 'utf8'});
		if(!rv || rv.error || rv.status) {
			console.log(rv);
			process.exit(1);
		}
		db.finished = true;
	}
}

// Done.
fs.writeFileSync(dbfn, JSON.stringify(DB, null, '\t'));
process.exit(0);
