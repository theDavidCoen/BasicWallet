/**
 * App identity for Settings → About (Penpot 05f).
 * Bump with package.json / app.json on release.
 */

export const APP_VERSION = "0.9.1-alpha.1";

/**
 * Short commit for Settings → About.
 * Local / pre-release: `"dev"`.
 * On a real release (David: crea release / release reale): set to `git rev-parse --short HEAD`.
 * See `.cursor/rules/basic-wallet-release-buildinfo.mdc` and Mind `basic-wallet`.
 */
export const APP_GIT_COMMIT = "fd58738";

export const APP_GITHUB_URL = "https://github.com/theDavidCoen/BasicWallet";
export const APP_GITHUB_LABEL = "theDavidCoen/BasicWallet";

/**
 * About → License link.
 * Placeholder `#` until LICENSE is on GitHub; then set to
 * `https://github.com/theDavidCoen/BasicWallet/blob/main/LICENSE` (or tag).
 * Mind: topics/basic-wallet/entities/basic-wallet.md
 */
export const APP_LICENSE_URL = "#";
