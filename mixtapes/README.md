# mixtapes

Remixes portions of MP4 files using a combination of tools:

*	[FFmpeg](http://www.ffmpeg.org/) specifically `ffmpeg` and `ffprobe`
*	[GPAC](https://gpac.wp.mines-telecom.fr/mp4box/) specifically `mp4box`
*	[AtomicParsley]((http://atomicparsley.sourceforge.net/)

These tools must be in the current process PATH.

To determine the output files and the input files and the portions thereof from whence the output
is created, the script uses a `db.json` file with the following schema:

```
class DbJson {
	inputs: InputSpec[],
	outputs: OutputSpec[]
}

class InputSpec {
	title: number,
	file: string,
	chapters: InputChapter[]
}

class InputChapter {
	chapter: number,
	start?: number|string,
	end?: number|string,
	duration?: number|string,
	name?: string,
	next?: number
}

class OutputSpec {
	file: string,
	title?: string,
	author?: string,
	artwork?: string,
	series?: string,
	season?: number,
	episode?: number,
	chapters: OutputChapter[]
}

class OutputChapter {
	title: number,	// references an InputSpec
	chapter: number	// references an InputChapter of the corresponding InputSpec
}
```

The chapter start, end, and durations are either seconds (number) or `hh:mm:ss.fff` (string) format.
If an `InputChapter` has a `start` property defined, it must also have either the `end` or the
`duration` property defined. (An error is thrown if both `end` and `duration` are defined.)
If an `InputChapter` does not have a `start` property, then it must not have an `end` or a
`duration`: these values, instead, are taken from the chapter markers given in the input MP4 file.

If `next` is defined for an input chapter, the chapter is implicitly extended to end after the
next _n_ chapters, where _n_ is the value of `next`.

MP4 video data is copied, not transcoded. As a result, chapter start points in input files are
always aligned to the closest keyframe. Chapters do not need to end on a keyframe.

If an `InputChapter` has a `name` property defined, the output files are generated with this
string in the chapter list, overriding any chapter name given in the input file. If the
`InputChapter` does not have a `name` defined, then the name of the chapter given in the
input file (if any) is used.

The `file` properties of `InputSpec` and `OutputSpec` are file paths. If relative, they are made
absolute relative to the location of the input `db.json` file.

If an `OutputSpec` has `series` defined, the `@stik` metadata will be automatically set to
`TV Show`.


## Building

`npm install`


## Running

`node mixtapes.js path-to-db-json [--debug]`

If successful, exits with status code 0. If an error occurs, details of the error are printed to
`stderr` and the process exits with status code 1.

If `--debug` is specified the temporary folder created during processing is _not_ deleted. The
contents thereof may be inspected to determine the cause for errors or incorrect output.

## Issues

Issues should be noted through the GitHub issue mechnanism.
