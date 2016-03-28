# Episodium

This is a utility script I wrote to automate renaming MP4 files and adding
metadata To do the heavy lifting the script utilizes the
[AtomicParsley](http://atomicparsley.sourceforge.net/) tool.

These utilities must be accessible in the current process PATH.

To determine the source files, their order, and other metadata, the script uses
a `db.json` file with the following format:

```
[{
	"series": "Series title",
	"season": 1,
	"episodes": [
		{
			"source": "filename.mp4",
			"episode": 1,
			"name": "Episode name",
		}
	]
}]
```

File names in the `db.json` file are relative to the `db.json` file itself. The
file is specified as a command-line argument.

Files are renamed with the series title and episode name separated by the
familiar `SxxEyy` convention for indicate season/episode numbers.

If successful, exits with status code 0. Nothing is printed to the console.

If an error occurs, diagnostic data is logged to the console and the process
exits with a non-zero status code.


# Building

Use `npm install` to download required dependencies.


# Running

`node episodium.js db.json`


# Issues

Issues should be noted through the GitHub issue mechanism.
