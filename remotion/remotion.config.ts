import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Captures are 2x-DPI PNGs of a 1920x1080 viewport; the default 8GB limit is
// plenty, but concurrency is capped so the video decoders for the .mp4 clips
// don't contend on a small CI box.
Config.setConcurrency(4);
