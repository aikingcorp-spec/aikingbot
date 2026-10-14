# Voice test audio

`jfk-16k.wav`: 11 s of John F. Kennedy's 1961 inaugural address plus 3 s of silence, 16 kHz mono PCM16.
The speech is a US government work (public domain); the source file is `tests/jfk.flac` from
github.com/openai/whisper (MIT). Use it as Chromium's fake microphone:
`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<path>`.
