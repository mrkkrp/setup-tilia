import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import * as tool_cache from '@actions/tool-cache';

// The newest release this action knows about. 'latest' resolves to this
// rather than to whatever GitHub calls latest today, so that a workflow
// that pins nothing still formats the same way tomorrow as it did today.
const DEFAULT_TILIA_VERSION = '0.0.1.0';

const TOOL = 'tilia';
const REPOSITORY = 'mrkkrp/tilia';

// The files that decide what Tilia will have to read. Its own cache is
// keyed on the dependencies it resolved fixities from, and the package
// cache holds the sources of those same dependencies, so both turn over
// exactly when one of these changes.
const FINGERPRINTED = ['cabal.project', 'cabal.project.freeze', '**/*.cabal'];

/** The release asset for the machine this is running on. */
function assetFor(version: string): string {
  const system = ((): string => {
    switch (process.platform) {
      case 'win32':
        return 'x86_64-windows';
      case 'darwin':
        return process.arch === 'arm64' ? 'aarch64-darwin' : 'x86_64-darwin';
      default:
        return 'x86_64-linux';
    }
  })();
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
  return `${TOOL}-${version}-${system}.${extension}`;
}

/**
 * The copy of this version an earlier run left on the runner, if any.
 *
 * Asked of the directory rather than of `tool_cache.find`, which matches
 * versions with semver and so can never match one of ours: a Haskell
 * version has four components, and `semver.clean('0.0.1.0')` is null. The
 * layout is the one `tool_cache.cacheDir` writes, marker file and all.
 *
 * This only ever finds anything on a runner whose tool cache outlives the
 * job, which is to say a self-hosted one.
 */
function alreadyInstalled(version: string): string | undefined {
  const root = process.env['RUNNER_TOOL_CACHE'];
  if (!root) {
    return undefined;
  }
  const directory = path.join(root, TOOL, version, os.arch());
  return fs.existsSync(`${directory}.complete`) ? directory : undefined;
}

/** Install Tilia, or find the copy an earlier run already left here. */
async function provision(version: string): Promise<string> {
  const already = alreadyInstalled(version);
  if (already) {
    core.info(`Tilia ${version} was already on this runner`);
    return already;
  }

  const asset = assetFor(version);
  const url = `https://github.com/${REPOSITORY}/releases/download/v${version}/${asset}`;
  core.info(`Downloading ${url}`);
  const archive = await tool_cache.downloadTool(url);

  const unpacked = asset.endsWith('.zip')
    ? await tool_cache.extractZip(archive)
    : await tool_cache.extractTar(archive);

  return await tool_cache.cacheDir(unpacked, TOOL, version);
}

/**
 * Where Tilia keeps what it has worked out about a package's fixities.
 *
 * The same directory the `directory` package would hand it: the XDG cache
 * directory everywhere but Windows, and the local application data
 * directory there.
 */
function ownCacheDirectory(): string | undefined {
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'];
    return local ? path.join(local, TOOL) : undefined;
  }
  const xdg = process.env['XDG_CACHE_HOME'];
  const root = xdg ? xdg : path.join(os.homedir(), '.cache');
  return path.join(root, TOOL);
}

/** What cabal says about the machine and the project. */
interface CabalAnswers {
  /**
   * Where cabal keeps the source tarballs of everything it has downloaded.
   *
   * Asked of cabal rather than worked out, because the answer differs by
   * platform and has moved once on Unix: it is `C:\cabal\packages` on a
   * GitHub Windows runner, under the XDG cache directory on a current Unix
   * cabal, and in `~/.cabal` on an older one. Tilia reads this directory to
   * learn the fixities of operators belonging to packages that were planned
   * but never installed.
   */
  packages?: string;
  /**
   * The compiler the project is built with, as in `ghc-9.12.4`.
   *
   * Asked of cabal rather than of the `ghc` on `PATH`, because a project
   * can name another one with `with-compiler`.
   */
  compiler?: string;
}

/**
 * Ask cabal for its package cache and for the project's compiler.
 *
 * Both are undefined where there is no cabal to ask, which is a perfectly
 * ordinary state for a job that has not set up a Haskell toolchain yet.
 * Where cabal cannot find a compiler it will not answer about one at all,
 * so the package cache is then asked for on its own.
 */
async function askCabal(): Promise<CabalAnswers> {
  const both = await cabalPath(['--remote-repo-cache', '--compiler-info']);
  if (both) {
    return {
      packages: both.get('remote-repo-cache'),
      compiler: both.get('compiler-id'),
    };
  }
  const alone = await cabalPath(['--remote-repo-cache']);
  return { packages: alone?.get('remote-repo-cache') };
}

/**
 * Run `cabal path` with the given flags and read its answers by key.
 *
 * Undefined if cabal could not be run or refused.
 */
async function cabalPath(
  flags: string[]
): Promise<Map<string, string> | undefined> {
  let spoken = '';
  const code = await exec.exec('cabal', ['path', ...flags], {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        spoken += data.toString();
      },
    },
  });
  if (code !== 0) {
    return undefined;
  }
  // A cabal that finds no configuration file writes one and says so first,
  // on the same stream it answers on. Asked one thing, it answers with the
  // bare value on the last line; asked several, with a `key: value` line
  // for each.
  const lines = spoken
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const answers = new Map<string, string>();
  if (flags.length === 1) {
    if (lines.length > 0) {
      answers.set(flags[0].replace(/^--/, ''), lines[lines.length - 1]);
    }
    return answers;
  }
  for (const line of lines) {
    const answer = /^([a-z-]+): (.*)$/.exec(line);
    if (answer) {
      answers.set(answer[1], answer[2]);
    }
  }
  return answers;
}

/**
 * Everything worth carrying from one run to the next, as the paths and
 * patterns `@actions/cache` takes, and the compiler it was worked out for.
 */
async function cacheable(): Promise<{
  paths: string[];
  compiler: string | undefined;
}> {
  const found: string[] = [];
  const own = ownCacheDirectory();
  if (own) {
    found.push(own);
  } else {
    core.warning('Could not work out where Tilia keeps its own cache');
  }
  const { packages, compiler } = await askCabal();
  if (packages) {
    // What each repository holds rather than the directory itself, since a
    // directory is archived whole and no `!` pattern takes anything out of
    // it. Hackage's index is then left out: it is most of the package cache
    // and is no use to Tilia, and restored after `cabal update` an old one
    // would replace the fresh one.
    found.push(path.join(packages, '*', '*'));
    found.push(`!${path.join(packages, '*', '01-index.*')}`);
  } else {
    core.info(
      'No cabal on PATH, so the package cache is not being cached. Run ' +
        'haskell-actions/setup before this action to have it, and to let ' +
        'Tilia resolve fixities from dependency sources at all.'
    );
  }
  return { paths: found, compiler };
}

/**
 * What to file the caches under.
 *
 * The compiler is part of it because both directories fill up with what
 * that compiler's build plan needs, so jobs of a matrix over compilers
 * would otherwise share one key: the first of them to finish would save
 * the cache and the rest would restore it and never get to save their own.
 */
async function cacheKeys(
  prefix: string,
  version: string,
  compiler: string | undefined
): Promise<{ key: string; restoreKeys: string[] }> {
  const fingerprint = await glob.hashFiles(FINGERPRINTED.join('\n'));
  const forThisRunner = [
    prefix,
    version,
    process.platform,
    process.arch,
    ...(compiler ? [compiler] : []),
  ].join('-');
  return {
    // A fingerprint of nothing means the project names no packages, which
    // is unusual but not an error; the key stays well-formed either way.
    key: `${forThisRunner}-${fingerprint || 'no-packages'}`,
    restoreKeys: [`${forThisRunner}-`],
  };
}

async function setUp(): Promise<void> {
  const asked = core.getInput('version');
  const version = asked === 'latest' ? DEFAULT_TILIA_VERSION : asked;
  const wantsCache = core.getInput('cache').toUpperCase() !== 'FALSE';
  const prefix = core.getInput('cache-prefix');

  const directory = await provision(version);
  const executable = path.join(
    directory,
    process.platform === 'win32' ? `${TOOL}.exe` : TOOL
  );

  if (process.platform !== 'win32') {
    await exec.exec('chmod', ['+x', executable], { silent: true });
  }

  core.addPath(directory);
  core.setOutput('tilia-path', executable);
  core.setOutput('version', version);

  // Proof that what was installed is what was asked for, and that it runs
  // on this machine at all, before anything downstream depends on it.
  await exec.exec(executable, ['--version']);

  if (!wantsCache) {
    core.setOutput('cache-hit', 'false');
    return;
  }

  // Not every runner has somewhere to cache to—a self-hosted one without
  // the service, or a fork's job with no write access. Saying so and
  // carrying on is right: the caches make a run quicker and a run without
  // them is still correct.
  if (!cache.isFeatureAvailable()) {
    core.info('This runner offers no cache service, so nothing is cached');
    core.setOutput('cache-hit', 'false');
    return;
  }

  const { paths, compiler } = await cacheable();
  if (paths.length === 0) {
    core.setOutput('cache-hit', 'false');
    return;
  }

  const { key, restoreKeys } = await cacheKeys(prefix, version, compiler);
  let matched: string | undefined;
  try {
    matched = await cache.restoreCache(paths.slice(), key, restoreKeys);
  } catch (error) {
    core.warning(`Could not read the cache: ${(error as Error).message}`);
    core.setOutput('cache-hit', 'false');
    return;
  }
  const exact = matched === key;
  const directories = paths.filter((p) => !p.startsWith('!')).length;

  core.info(
    matched
      ? `Restored ${directories} director${directories === 1 ? 'y' : 'ies'} from ${matched}`
      : 'Nothing cached yet for this project'
  );

  core.setOutput('cache-hit', exact ? 'true' : 'false');
  core.saveState('paths', JSON.stringify(paths));
  core.saveState('key', key);
  core.saveState('matched', matched ?? '');
}

/**
 * Save what the run filled in, once it is over.
 *
 * Skipped on an exact hit, where saving would be refused anyway: a key that
 * is already there cannot be written again.
 */
async function tearDown(): Promise<void> {
  const stored = core.getState('paths');
  const key = core.getState('key');
  if (!stored || !key) {
    return;
  }
  if (core.getState('matched') === key) {
    core.info(`Nothing to save: ${key} was restored exactly`);
    return;
  }
  try {
    await cache.saveCache(JSON.parse(stored) as string[], key);
    core.info(`Saved ${key}`);
  } catch (error) {
    // A cache that will not save is a slower next run and nothing worse,
    // so it must not be allowed to fail a job that has already passed.
    core.warning(`Could not save the cache: ${(error as Error).message}`);
  }
}

// One entry point for both halves, which is how a JavaScript action gets a
// post step. The state is set by the main half and is only there when the
// post half runs.
if (core.getState('post') === 'true') {
  tearDown().catch((error: Error) => core.warning(error.message));
} else {
  core.saveState('post', 'true');
  setUp().catch((error: Error) => core.setFailed(error.message));
}
