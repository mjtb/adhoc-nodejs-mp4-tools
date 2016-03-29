var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var os = require('os');

function fsExistsFileSync(fn) {
	try {
		var st = fs.statSync(fn);
		return st != null && st.isFile();
	} catch(err) {
		return false;
	}
}
function twoDigit(n) {
	if(n > 10) {
		return String(n);
	} else {
		return '0' + String(n);
	}
}
function formatArgv(arg) {
	var o = os.platform().toLowerCase();
	var quot = [], esc = [], ech = '';
	if(o === 'win32' || o === 'win64') {
		esc = [ '^', '\"', '%' ];
		quot = [ ' ', '/', '^', '|', '<', '>', '&', '?', '*', '(', ')', '%', '\"', '\'', '!' ];
		ech = '^';
	} else {
		quot = [' ', '<', '>', '|', '?', '*', '(', ')', '&'];
		ecs = ['\\', '\'', '\"'];
		ech = '\\';
	}
	var rv = '';
	var args;
	if(Array.isArray(arg)) {
		args = arg;
	} else {
		args = [ arg ];
	}
	for(var i = 0; i < args.length; ++i) {
		var a = args[i];
		if(i > 0) {
			rv += ' ';
		}
		var quote = false;
		for(var j = 0; j < a.length; ++j) {
			var c = a.charAt(j);
			for(var k = 0; k < quot.length; ++k) {
				if(c === quot[k]) {
					quote = true;
					break;
				}
			}
		}
		if(quote) {
			rv += '\"';
		}
		for(var j = 0; j < a.length; ++j) {
			var c = a.charAt(j);
			for(var k = 0; k < esc.length; ++k) {
				if(c === esc[k]) {
					rv += ech;
					break;
				}
			}
			rv += c;
		}
		if(quote) {
			rv += '\"';
		}
	}
	return rv;
}
var dbfn = path.join(process.cwd(), "db.json");
if(process.argv.length > 2)  {
	switch(process.argv[2]) {
		default:
		dbfn = path.resolve(process.cwd(), process.argv[2]);
		break;
		case '--help':
		case '-h':
		case '/h':
		case '/?':
		console.log('Renames MP4 files and adds metadata.');
		console.log('syntax: node episodium.js (db.json)?');
		process.exit(0);
		break;
	}
}
if(!fsExistsFileSync(dbfn)) {
	console.log(`${dbfn}: file not found`);
	process.exit(1);
}

var db = JSON.parse(fs.readFileSync(dbfn));
if(!db) {
	console.log(`${dbfn}: file not parsed`);
	process.exit(1);
} else if(!Array.isArray(db)) {
	var t = [];
	t.push(db);
	db = t;
}
var dbdir = path.dirname(dbfn);
var dryrun = false;
for(var i = 0; i < db.length; ++i) {
	var s = db[i];
	for(var j = 0; j < s.episodes.length; ++j) {
		var e = s.episodes[j];
		var season = e['season'] || s['season'];
		var episode = e['episode'];
		var middle = '';
		if(season) {
			middle = 'S' + twoDigit(season);
		}
		if(episode) {
			middle += 'E' + twoDigit(episode);
		}
		if(middle) {
			middle = ' ' + middle + ' ';
		} else {
			middle = ' - ';
		}
		var src = e['source'] || s['source'].replace('${title}', e.title);
		src = path.resolve(dbdir, src);
		var srcdir = path.dirname(src);
		var tmpval = (new Date()).valueOf();
		var tmp = path.join(srcdir, 'episodium-tmp-' + tmpval + '.mp4');
		var bak = path.join(srcdir, 'episodium-bak-' + tmpval + '.mp4');
		var dst = path.join(srcdir, s.series + middle + e.name + '.mp4');
		var args = [];
		args.push(src);
		args.push('--output');
		args.push(tmp);
		args.push('--title');
		args.push(s.series + ' - ' + e.name);
		args.push('--TVShowName');
		args.push(s.series);
		args.push('--TVEpisode');
		args.push(e.name);
		if(season) {
			args.push('--TVSeasonNum');
			args.push(season);
		}
		if(episode) {
			args.push('--TVEpisodeNum');
			args.push(episode);
		}
		try {
			console.log('atomicparsley ' + formatArgv(args));
			if(!dryrun) {
				var ps = child_process.spawnSync('atomicparsley', args, {'stdio': ['ignore', 'pipe', 'pipe'], 'encoding': 'utf8'});
				if(!ps || ps.error || ps.status) {
					console.log(ps);
				}
			}
		} catch(err) {
			console.log(err);
		}
		console.log('mv ' + formatArgv(src) + ' ' + formatArgv(bak));
		if(!dryrun) {
			fs.renameSync(src, bak);
		}
		if(fsExistsFileSync(dst)) {
			console.log('rm ' + formatArgv(dst));
			if(!dryrun) {
				fs.unlinkSync(dst);
			}
		}
		console.log('mv ' + formatArgv(tmp) + ' ' + formatArgv(dst));
		if(!dryrun) {
			fs.renameSync(tmp, dst);
		}
		console.log('rm ' + formatArgv(bak));
		if(!dryrun) {
			fs.unlinkSync(bak);
		}
	}
}
fs.writeFileSync(dbfn, JSON.stringify(db, null, '\t'));
