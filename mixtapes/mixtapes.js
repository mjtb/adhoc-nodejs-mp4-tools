const fs = require('fs-extra');
const path = require('path');
const child_process = require('child_process');
const os = require('os');
const xmldom = require('xmldom');
const format_argv = require('../shared/format_argv');

function main() {
	if(process.argv.length < 3 || process.argv[2] === "--help") {
		console.error('syntax: node mixtapes.js path-to-db.json [--debug]');
	} else {
		var filename = path.resolve(process.argv[2]);
		var debug_mode = (process.argv.length > 3) && (process.argv[3] === '--debug');
		var err;
		try {
			var tmp = fs.mkdtempSync(os.tmpdir() + '/mixtapes-' + String((new Date()).valueOf()));
			console.log(`Using temporary folder: ${tmp}…`);
			var db = readDbJson(filename);
			var dir = path.dirname(filename);
			fillInMissingInputChapterInfo(db, dir, tmp);
			fs.writeFileSync(path.resolve(tmp, 'db.json'), JSON.stringify(db, null, 4));
			decomposeInputs(db, tmp);
			composeOutputs(db, dir, tmp);
		} catch(e) {
			err = e;
		} finally {
			if(!debug_mode) {
				console.log(`Cleaning up temporary folder…`);
				fs.removeSync(tmp);
			} else {
				console.log(`NOT cleaning up temporary folder becuase --debug was specified…`);
			}
		}
		if(err) {
			throw err;
		}
	}
}

function failIf(err) {
	console.err(err);
	process.exit(1);
}

function readDbJson(filename) {
	console.log('Reading input db.json…');
	var data = fs.readFileSync(filename);
	return JSON.parse(data);
}

function fillInMissingInputChapterInfo(db, dir, tmp) {
	for(var i = 0; i < db.inputs.length; ++i) {
		var input = db.inputs[i];
		input.file = path.resolve(dir, input.file);
		var fch = getChaptersInFile(input.file);
		if(tmp) {
			fs.writeFileSync(path.resolve(tmp, 'chapters_in_file.json'), JSON.stringify(fch, null, 4));
		}
		for(var j = 0; j < input.chapters.length; ++j) {
			var ch = input.chapters[j];
			var chf = fch.find((e) => e.chapter === ch.chapter);
			if(ch.hasOwnProperty('start')) {
				ch.start = parse_time(ch.start);
			} else if(chf) {
				ch.start = chf.start;
			} else {
				throw new Error(`db.json schema violation: input title ${input.title} (index: ${i}), chapter: ${ch.chapter} (index: ${j}): cannot determine chapter start`);
			}
			if(!ch.hasOwnProperty('name')) {
				if(chf) {
					ch.name = chf.name;
				} else {
					ch.name = '';
				}
			}
			if(ch.hasOwnProperty('end') && ch.hasOwnProperty('duration')) {
				throw new Error(`db.json schema violation: input title ${input.title} (index: ${i}), chapter: ${ch.chapter} (index: ${j}): InputChapter must not define both end and duration`);
			}
		}
		if(!input['audiobook']) {
			alignChapterStartsToKeyframes(input.file, input.chapters, tmp);
		}
		for(var j = 0; j < input.chapters.length; ++j) {
			var ch = input.chapters[j];
			var ech = ch.chapter;
			if(ch.hasOwnProperty('next')) {
				ech += Number(ch.next);
			}
			var chf = fch.find((e) => e.chapter === ech);
			if(ch.hasOwnProperty('end')) {
				ch.end = parse_time(ch.end);
			} else if(ch.hasOwnProperty('duration')) {
				ch.duration = parse_time(ch.duration);
				ch.end = ch.start + ch.duration;
				delete ch.duration;
			} else if(chf) {
				ch.end = chf.end;
			} else {
				throw new Error(`db.json schema violation: input title ${input.title} (index: ${i}), chapter: ${ch.chapter} (index: ${j}): cannot determine chapter end`);
			}
		}
		if(!input['audiobook']) {
			if(!db.subtitles) {
				db.subtitles = getSubtitles(input.file, input.chapters, tmp);
			}
		}
	}
}

function getSubtitles(file, chapters, tmp) {
	var rv = run_command('ffprobe', [ '-i', file ]);
	var input = String(rv.stderr);
	var re = /^\s*Stream\s+\#0\:(\d)\(eng\)\:\s+Subtitle\:\s+mov_text\s+\(tx3g\s+\/\s+0x67337874\)/gm;
	var rm = re.exec(input);
	if(!rm) {
		return null;
	}
	var streamNumber = Number(rm[1]) + 1;
	rv = run_command('mp4box', [ '-stdb', '-ttxt', streamNumber, file ]);
	var input = String(rv.stdout);
	if(tmp) {
		fs.writeFileSync(path.resolve(tmp, path.basename(file, '.mp4') + '.ttxt'), input);
	}
	var doc = new xmldom.DOMParser().parseFromString(input);
	var ts = doc.documentElement.getElementsByTagName('TextSample');
	var samples = [];
	var ser = new xmldom.XMLSerializer();
	for(var i = 0; i < ts.length; ++i) {
		var s = ts[i];
		var t = parse_time(s.getAttribute('sampleTime'));
		s.removeAttribute('sampleTime');
		var rtx = ser.serializeToString(s).replace(/\r?\n/g, ' ');
		var rex = /\<TextSample[^\>]*\>(.*)\<\/TextSample\>/.exec(rtx);
		if(rex) {
			samples.push({ 't': t, 'x': rex[1] });
		}
	}
	for(var i = 0; i < chapters.length; ++i) {
		var chapter = chapters[i];
		chapter.subtitles = [];
		for(var j = 0; j < samples.length; ++j) {
			var s = samples[j];
			if(s.t >= chapter.start && s.t <= chapter.end) {
				chapter.subtitles.push({ 't': s.t - chapter.start, 'x': s.x });
			}
		}
	}
	var tsh = doc.documentElement.getElementsByTagName('TextStreamHeader')[0];
	return ser.serializeToString(tsh);
}

function decomposeInputs(db, tmp) {
	for(var i = 0; i < db.inputs.length; ++i) {
		var input = db.inputs[i];
		console.log(`Decomposing input file: ${input.file}…`);
		for(var j = 0; j < input.chapters.length; ++j) {
			var chapter = input.chapters[j];
			chapter.file = path.resolve(tmp, `t${i}-c${j}.mp4`);
			run_command('ffmpeg', [ '-loglevel', 'fatal', '-ss', chapter.start, '-to', chapter.end, '-i', input.file, '-codec', 'copy', chapter.file ]);
		}
	}
}

function composeOutputs(db, dir, tmp) {
	for(var i = 0; i < db.outputs.length; ++i) {
		var output = db.outputs[i];
		output.file = path.resolve(dir, output.file);
		console.log(`Composing output file: ${output.file}…`);
		var files = [];
		var st = 0;
		var subtitles = [];
		var inches = [];
		for(var j = 0; j < output.chapters.length; ++j) {
			var outch = output.chapters[j];
			var input = db.inputs.find((e) => e.title === outch.title);
			if(!input) {
				throw new Error(`db.json schema violation: output index: ${i}, chapter index: ${j} references non-existant input title #${outch.title}`);
		 	}
			var inch = input.chapters.find((e) => e.chapter === outch.chapter);
			if(!inch) {
				throw new Error(`db.json schema violation: output index: ${i}, chapter index: ${j} references non-existant chapter #${outch.chapter} of input title #${outch.title}`);
			}
			inches.push(inch.file);
			files.push(`file '${inch.file}'`);
			if(!outch.hasOwnProperty('name')) {
				outch.name = inch.name;
			}
			if(inch.subtitles) {
				for(var k = 0; k < inch.subtitles.length; ++k) {
					var subt = inch.subtitles[k];
					var hms = format_time(st + subt.t);
					subtitles.push(`<TextSample sampleTime="${hms}" xml:space="preserve">${subt.x}</TextSample>`);
				}
			}
			outch.start = st;
			outch.duration = (inch.end - inch.start);
			st += outch.duration;
		}
		var txt = path.resolve(tmp, 'concat-' + i + '-' + String((new Date()).valueOf()) + '.txt');
		fs.writeFileSync(txt, files.join('\n'));
		if(files.length > 1) {
			run_command('ffmpeg', [ '-safe', '0', '-loglevel', 'fatal', '-y', '-f', 'concat', '-i', txt, '-c', 'copy', '-movflags', '+faststart', output.file ]);
		} else {
			run_command('ffmpeg', [ '-safe', '0', '-loglevel', 'fatal', '-y', '-i', inches[0], '-c', 'copy', '-movflags', '+faststart', output.file ]);
		}
		if(db.subtitles && subtitles.length > 0) {
			output.subtitles = path.resolve(tmp, 'cc-' + i + '.ttxt');
			fs.writeFileSync(output.subtitles, [ '<?xml version="1.0" encoding="UTF-8"?>', '<TextStream version="1.1">', db.subtitles ].concat(subtitles, [ '</TextStream>' ]).join('\n'));
		}
		addChapterMarkers(output, dir, tmp);
		if(['title', 'author', 'artwork', 'series', 'season', 'episode'].some((x) => output.hasOwnProperty(x))) {
			addMetadata(output, path, dir);
		}
	}
}

function addChapterMarkers(output, dir, tmp) {
	console.log(`Adding chapter markers to file: ${output.file}…`);
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
	for(var i = 0; i < output.chapters.length; ++i) {
		var ts = doc.documentElement.appendChild(doc.createElement('TextSample'));
		ts.setAttribute('sampleTime', format_time(output.chapters[i].start));
		ts.textContent = output.chapters[i].name;
	}
	var ser = new xmldom.XMLSerializer();
	var tvar = String((new Date()).valueOf());
	var chapttxt = path.resolve(tmp, `chapters-${tvar}.ttxt`);
	fs.writeFileSync(chapttxt, ser.serializeToString(doc));
	var tmp4 = path.join(dir, `tmp-${tvar}.mp4`);
	var args = [ '-ipod', '-add', `${output.file}#video`, '-add', `${output.file}#audio`, '-add', `${chapttxt}:chap` ];
	if(output.subtitles) {
		args.push('-add');
		args.push(output.subtitles + ':lang=eng');
	}
	args.push(tmp4);
	run_command('mp4box', args);
	var tmp42 = path.join(dir, `tmp-${tvar}-orig.mp4`);
	fs.renameSync(output.file, tmp42);
	fs.renameSync(tmp4, output.file);
	fs.unlinkSync(tmp42);
}

function addMetadata(output, path, dir) {
	var movie = output.file;
	var args = [ movie, '--overWrite' ];
	if(output.hasOwnProperty('artwork')) {
		var artwork = path.resolve(dir, output.artwork);
		console.log(`Ading artwork from file: ${artwork} to movie file: ${movie}…`);
		args.push('--artwork');
		args.push(artwork);
	}
	if(output.hasOwnProperty('title')) {
		args.push('--title');
		args.push(output.title);
	}
	if(output.hasOwnProperty('author')) {
		args.push('--artist');
		args.push(output.author);
	}
	if(output.hasOwnProperty('season')) {
		args.push('--TVSeasonNum');
		args.push(output.season);
	}
	if(output.hasOwnProperty('episode')) {
		args.push('--TVEpisodeNum');
		args.push(output.episode);
	}
	if(output.hasOwnProperty('series')) {
		args.push('--TVShowName');
		args.push(output.series);
		args.push('--stik');
		args.push('TV Show');
	}
	run_command('atomicparsley', args);
}

function getChaptersInFile(filename) {
	console.log(`Reading chapters of input file: ${filename}…`);
	var rv = run_command('ffprobe', [ '-show_chapters', '-print_format', 'csv', filename ]);
	var re = /^chapter,(\d+),\d+\/\d+,\d+,([0-9.]+),\d+,([0-9.]+),(.*)$/gm;
	var input = String(rv.stdout);
	var chapters = [];
	for(var rm = re.exec(input); rm !== null; rm = re.exec(input)) {
		var chapter = {
			'chapter': Number(rm[1]) + 1,
			'start': Number(rm[2]),
			'end': Number(rm[3]),
			'name': String(rm[4])
		};
		chapters.push(chapter);
	}
	return chapters;
}

function alignChapterStartsToKeyframes(filename, chapters, tmp) {
	console.log(`Searching for keyframes nearest chapter markers in input file: ${filename}…`);
	var read_intervals = [];
	for(var i = 0; i < chapters.length; ++i) {
		read_intervals.push(Math.max(0, chapters[i].start - 20).toFixed(3) + '%+40');
	}
	if(read_intervals.length > 0) {
		var inputs = [];
		for(var ri = 0; ri < read_intervals.length; ++ri) {
			var rv = run_command('ffprobe', [ '-i', filename, '-print_format', 'csv', '-show_frames', '-read_intervals', read_intervals[ri] ]);
			inputs.push(String(rv.stdout));
		}
		var re = /^frame,video,.,1,\d+,([0-9.]+),/gm;
		var keyframes = [];
		var input = inputs.join('\n');
		if(tmp) {
			fs.writeFileSync(path.resolve(tmp, 'keyframes.txt'), input);
		}
		for(var rm = re.exec(input); rm !== null; rm = re.exec(input)) {
			keyframes.push(Number(rm[1]));
		}
		keyframes.sort((a,b) => a - b);
		for(var i = keyframes.length - 1; i > 0; --i) {
			if(keyframes[i] === keyframes[i - 1]) {
				keyframes.splice(i, 1);
			}
		}
		if(tmp) {
			fs.writeFileSync(path.resolve(tmp, 'keyframes.json'), JSON.stringify(keyframes, null, 4));
		}
		for(var i = 0; i < chapters.length; ++i) {
			if(chapters[i].start > 0) {
				var index = 0;
				var delta = Math.abs(keyframes[index] - chapters[i].start);
				for(var j = 1; j < keyframes.length; ++j) {
					var d = Math.abs(keyframes[j] - chapters[i].start);
					if(d < delta) {
						index = j;
						delta = d;
					} else {
						break;
					}
				}
				chapters[i].start = keyframes[index];
				chapters[i].delta = delta;
			}
		}
	}
	return chapters;
}

function parse_time(t) {
	if(typeof(t) === "number") {
		return t;
	} else {
		var re = /([0-9]{2}):([0-9]{2}):([0-9]{2}(?:\.[0-9]+)?)/;
		var rx = re.exec(String(t));
		var h = Number(rx[1]), m = Number(rx[2]), s = Number(rx[3]);
		return ((h * 60) + m) * 60 + s;
	}
}

function format_time(sec) {
	var ws = Math.trunc(sec);
	var h = Math.trunc(ws / 3600);
	var m = Math.trunc((ws - 3600 * h) / 60);
	var s = sec - h * 3600 - m * 60;
	const dig = function(v, p) {
		if(v < 10) {
			return '0' + v.toFixed(p);
		} else {
			return v.toFixed(p);
		}
	}
	return dig(h,0) + ':' + dig(m,0) + ':' + dig(s,3);
}

function run_command(cmd, args) {
	console.log(cmd + ' ' + format_argv(args));
	var rv = child_process.spawnSync(cmd, args, { stdio: [ 'ignore', 'pipe', 'pipe'], encoding: 'utf8'});
	if(!rv) {
		throw new Error(cmd + ': not in path?');
	} else if(rv.error || rv.status) {
		throw new Error(cmd + ' failed: ' + JSON.stringify(rv, null, 4));
	} else {
		return rv;
	}
}

try {
	main();
	process.exit(0);
} catch(e) {
	console.error(e);
	process.exit(1);
}
