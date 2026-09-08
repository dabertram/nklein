The platform specification you are planning against. It is READ-ONLY input: never edit it.

The verifier reads it on every run and derives the obligation set, each obligation's module, the modules each
obligation's implementation uses, which obligations are documentation-only, and the card ceiling — all of it from
this file. Changing it changes what you are graded against, which is cheating, and the reviewer will see it in the
diff.

The suite hashes this file on every run: if it changes, every test run fails and says so.
