## Unreleased

* Key the caches on the project's compiler too, so that jobs of a matrix
  over compilers each keep their own cache instead of all but one of them
  restoring a cache they can never save to.
* Leave Hackage's index out of the cached package cache. It was most of
  the cache's size, and restoring it after `cabal update` replaced the
  fresh index with an old one.

## setup-tilia 1.0.0

* Initial release.
