## setup-tilia v2

* Install Tilia 0.0.2.0 by default.
* Key the caches on the project's compiler too, so that jobs of a matrix
  over compilers each keep their own cache instead of all but one of them
  restoring a cache they can never save to.
* Leave Hackage's index and its security metadata out of the cached package
  cache. The index was most of the cache's size, and restoring it after
  `cabal update` could replace the fresh index with an old one.

## setup-tilia v1

* Initial release.
