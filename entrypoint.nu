#!/usr/bin/env nu

def --wrapped main [...cmd] {
  let creds = (fnox get PROTON_PASS_CREDENTIALS | complete)
  if $creds.exit_code == 0 and ($creds.stdout | str trim) == "true" {
    $env.PROTON_PASS_KEY_PROVIDER = "fs"
    mise run setup-pass-cli
  }

  let exported = (fnox export --all --profile scrapper --format json | complete)
  if $exported.exit_code != 0 {
    print -e "FATAL: fnox export failed"
    print -e $exported.stderr
    exit 1
  }
  $exported.stdout | from json | get -o secrets | default {} | load-env

  exec ...$cmd
}
