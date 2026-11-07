"""Run the actual TagBot SSH setup and Git push code against a disposable repo.

Run only in the dedicated acceptance workflow with DOCUMENTER_KEY in the environment.
No package registration or GitHub release is performed.
"""
import os
from types import SimpleNamespace
from tagbot.action.git import Git
from tagbot.action.repo import Repo

repository = os.environ["GITHUB_REPOSITORY"]
git = Git("https://github.com", repository, os.environ["GITHUB_TOKEN"], "PkgFactory PoC", "pkgfactory@users.noreply.github.com")
repo = Repo.__new__(Repo)
repo._gh_url = "https://github.com"
repo._repo = SimpleNamespace(ssh_url=f"git@github.com:{repository}.git")
repo._git = git
repo.configure_ssh(os.environ["DOCUMENTER_KEY"], None)
tag = "pkgfactory-key-poc-" + os.environ["GITHUB_RUN_ID"]
git.create_tag(tag, git.command("rev-parse", "HEAD"), "PkgFactory deploy-key acceptance test")
assert git.remote_tag_exists(tag), "TagBot did not push the test tag"
print("TagBot SSH setup and tag push succeeded")
