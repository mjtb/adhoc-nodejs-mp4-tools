module.exports = function (arg) {
	var os = require('os');
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
		var a = String(args[i]);
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
};
