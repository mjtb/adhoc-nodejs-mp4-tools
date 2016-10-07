const fs = require('fs-extra');
const path = require('path');
const child_process = require('child_process');
const os = require('os');
const xmldom = require('xmldom');
const format_argv = require('../shared/format_argv');

function main() {
	if(process.argv.length < 3 || process.argv[2] === "--help") {
		console.error('syntax: node mixtapes.js path-to-db.json');
	} else {
		var filename = path.resolve(process.argv[2]);
		var err;
		try {
			var tmp = fs.mkdtempSync(os.tmpdir() + '/mixtapes-' + String((new Date()).valueOf()));
			console.log(`Using temporary folder: ${tmp}…`);
			var db = readDbJson(filename);
			var dir = path.dirname(filename);
			fillInMissingInputChapterInfo(db, dir);
			decomposeInputs(db, tmp);
			composeOutputs(db, dir, tmp);
		} catch(e) {
			err = e;
		} finally {
			console.log(`Cleaning up temporary folder…`);
			fs.removeSync(tmp);
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

function fillInMissingInputChapterInfo(db, dir) {
	for(var i = 0; i < db.inputs.length; ++i) {
		var input = db.inputs[i];
		input.file = path.resolve(dir, input.file);
		var fch = getChaptersInFile(input.file);
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
			alignChapterStartsToKeyframes(input.file, input.chapters);
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
	}
}

function decomposeInputs(db, tmp) {
	for(var i = 0; i < db.inputs.length; ++i) {
		var input = db.inputs[i];
		console.log(`Decomposing input file: ${input.file}…`);
		for(var j = 0; j < input.chapters.length; ++j) {
			var chapter = input.chapters[j];
			chapter.file = path.resolve(tmp, `t${i}-c${j}.mp4`);
			run_command('ffmpeg', [ '-loglevel', 'fatal', '-i', input.file, '-codec', 'copy', '-ss', chapter.start, '-to', chapter.end, chapter.file ]);
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
			files.push(`file '${inch.file}'`);
			if(!outch.hasOwnProperty('name')) {
				outch.name = inch.name;
			}
			outch.start = st;
			outch.duration = (inch.end - inch.start);
			st += outch.duration;
		}
		var txt = path.resolve(tmp, 'concat-' + String((new Date()).valueOf()) + '.txt');
		fs.writeFileSync(txt, files.join('\n'));
		var args = [ '-loglevel', 'fatal', '-y', '-f', 'concat', '-i', txt, '-c', 'copy', '-movflags', '+faststart', output.file ];
		if(output.title) {
			args.push('-metadata');
			args.push(`title=${output.title}`);
		}
		if(output.author) {
			args.push('-metadata');
			args.push(`author=${output.author}`);
		}
		run_command('ffmpeg', args);
		addChapterMarkers(output, dir, tmp);
		if(output.hasOwnProperty('artwork')) {
			addArtwork(output.file, path.resolve(dir, output.artwork));
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
	run_command('mp4box', [ '-ipod', '-add', `${output.file}#video`, '-add', `${output.file}#audio`, '-add', `${chapttxt}:chap`, tmp4 ]);
	var tmp42 = path.join(dir, `tmp-${tvar}-orig.mp4`);
	fs.renameSync(output.file, tmp42);
	fs.renameSync(tmp4, output.file);
	fs.unlinkSync(tmp42);
}

function addArtwork(movie, artwork) {
	console.log(`Ading artwork from file: ${artwork} to movie file: ${movie}…`);
	run_command('atomicparsley', [ movie, "--overWrite", "--artwork", artwork ]);
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

function alignChapterStartsToKeyframes(filename, chapters) {
	console.log(`Searching for keyframes nearest chapter markers in input file: ${filename}…`);
	var read_intervals = [];
	for(var i = 0; i < chapters.length; ++i) {
		read_intervals.push(Math.max(0, chapters[i].start - 20).toFixed(3) + '%+40');
	}
	if(read_intervals.length > 0) {
		var rv = run_command('ffprobe', [ '-i', filename, '-print_format', 'csv', '-show_frames', '-read_intervals', read_intervals.join(',') ]);
		var re = /^frame,video,.,1,\d+,([0-9.]+),/gm;
		var keyframes = [];
		var input = String(rv.stdout);
		for(var rm = re.exec(input); rm !== null; rm = re.exec(input)) {
			keyframes.push(Number(rm[1]));
		}
		for(var i = 0; i < chapters.length; ++i) {
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
	return chapters;
}

function parse_time(t) {
	if(typeof(t) === "number") {
		return t;
	} else {
		var re = /([0-9]{2}):([0-9]{2}):([0-9]{2}\.[0-9]+)/;
		var rx = re.exec(String(hms));
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
