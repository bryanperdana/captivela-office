/**
 * Build-wide switches for the Captivela Office fork.
 *
 * The upstream GenOffice code paths for Genspark's hosted services are left in
 * place (they are load-bearing for search, image generation and PDF→DOCX) but
 * are gated behind a single flag so the MVP never asks for a Genspark account
 * and never silently exposes a cloud capability it cannot deliver. Flipping the
 * flag back on restores the upstream behaviour without a code archaeology dig.
 */

/** Internal product name; the final public brand is still open. */
export const PRODUCT_NAME = 'Captivela Office'

/**
 * Genspark account login and the cloud-only capabilities that depend on it
 * (hosted deck generation, image generation, media analysis, PDF→DOCX upload).
 * Off for Phase 1: AI editing runs entirely against the user's own endpoint.
 */
export const GENSPARK_CLOUD_ENABLED = false
