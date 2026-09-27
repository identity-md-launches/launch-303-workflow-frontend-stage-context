# Portable committed delivery

The workspace's `.git` directory is read-only. A normal `git add -- web dist docs` failed with `Unable to create .git/index.lock: Read-only file system`. Source, static export and evidence remain in their requested locations for worktree collection.

`submission.bundle` is a portable Git bundle containing the implementation commit at **`refs/heads/frontend-delivery`**, together with its history including the pinned deployed source commit. The commit was created with isolated Git metadata in disposable `test/scratch/`, using this same worktree. Only `web/`, `dist/` and new documentation/evidence under `docs/` differ from the original commit. The original repository's `.git`, root configuration, contract source and libraries were not changed.

The bundle does not contain itself; including it would be recursive. Its commit does include this explanation, source, lockfile, static export, manifest, design document and validation evidence. The bundle is necessary to deliver the requested commit despite the read-only Git metadata; it contains no installed frontend dependencies or package archives.

To inspect in a writable checkout:

```sh
git bundle verify docs/submission.bundle
git fetch docs/submission.bundle refs/heads/frontend-delivery:refs/heads/frontend-delivery
git show --stat frontend-delivery
git diff frontend-delivery^ frontend-delivery -- web dist docs
```

The bundle can also be cloned independently with `git clone -b frontend-delivery docs/submission.bundle <destination>`. Publication is left to the publisher. Importing the bundle is optional if the publisher already collects and commits the delivered worktree.
