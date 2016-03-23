# Chapterrific

This is a utility script I wrote to automate concatenating several small MP4 files into a single
large MP4 file that has chapter markers for each of the originals. To do the heavy lifting the
script utilizes tools from several open source frameworks:

*	[FFmpeg](https://www.ffmpeg.org/), specificially `ffmpeg` and `ffprobe`
*	[GPAC](https://gpac.wp.mines-telecom.fr/mp4box/), specifically `mp4box`
*	[AtomicParsley](http://atomicparsley.sourceforge.net/)

These utilities must be accessible in the current process PATH.

To determine the source files, their order, and other metadata, the script uses a `db.json` file
with the following format:

```
{
	"album": "this will be the feature title and filename",
	"artist": "optional; self-evident",
	"artwork": "optional-artwork.jpg",
	"source": "see_note_below-${title}.mp4",
	"chapters": [
		{
			"title": 1,
			"name": "this will be the chapter name",
		}
	]
}
```

If chapter files are named according to a pattern that incorporates a DVD title number then set the
`source` property at the root to the filename pattern. The pattern illustrated above is typically of
what the popular [Handbrake]() utility produces. If there is no such general pattern for the source
files, you can omit the `source` property at the root and instead specify the per-chapter file names
with a `source` property on the individual chapters.

Files are concatenated according to the order given in the `chatpers` array and the value of each
chapters `title` number is not used to sort the files. The final file will be an MP4 file using the
`album` given in `db.json`.

File names in the `db.json` file are relative to the `db.json` file itself. By default, Chapterrific
looks for a file named `db.json` in same directory as chapterrific.js itself but this can be
overridden by passing the file path a command-line argument.

If successful, exits with status code 0. Nothing is printed to the console.

If an error occurs, diagnostic data is logged to the console and the process exits with a non-zero
status code.


# Building

Use `npm install` to download required dependencies.


# Running

`node chapterrific.js`


# Issues

Issues should be noted through the GitHub issue mechanism.
