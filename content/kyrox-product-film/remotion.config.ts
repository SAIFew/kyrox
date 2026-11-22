import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('png');
Config.setOverwriteOutput(true);
Config.setPublicDir('public');
if (process.env.CHROME_BIN) Config.setBrowserExecutable(process.env.CHROME_BIN);
