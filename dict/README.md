# Dictionary packs

The site's own copies of the JMdict packs, served at `/dict/` and
loaded by `src/dict/jmdict.js`. They are build-time artefacts: the
browser fetches one pack, once, and nothing here is fetched by the deploy.

| File | Pack | Entries | Lookup keys | Size (gz) |
| --- | --- | --- | --- | --- |
| `jmdict-eng-common.json.gz` | `common` | 22,640 | 54,154 | 1.4 MB |

Source: `scriptin/jmdict-simplified`, release `3.6.2+20260921173324`,
asset `jmdict-eng-common-*.json.tgz`. The file is that release's JSON,
gzipped unchanged - `src/dict/jmdict.js` reads `data.words` - so the
sizes measured in `docs/ja-reader-dictionary.md` apply directly.

JMdict is property of the Electronic Dictionary Research and Development Group,
used in conformance with the Group licence (Creative Commons BY-SA 4.0). The
attribution text is exported as `JMDICT_ATTRIBUTION` and must be
rendered wherever the data is shown.

## Rebuilding

    curl -sSL -o /tmp/common.tgz \
      "https://github.com/scriptin/jmdict-simplified/releases/download/3.6.2%2B20260921173324/jmdict-eng-common-3.6.2%2B20260921173324.json.tgz"
    tar -xzf /tmp/common.tgz -C /tmp
    gzip -9 -c /tmp/jmdict-eng-common-3.6.2.json > dict/jmdict-eng-common.json.gz

## The packs that are not committed

`full` (`jmdict-eng.json.gz`, 218,776 entries, 11.2 MB) and `names`
(`jmnedit-all.json.gz`) are named in `PACK_FILES` but not committed. Eleven
megabytes of dictionary in the public git history is a cost paid again on every
future release for a pack the reader does not load by default; build it the same
way and drop it in `dict/` when it is wanted.

## Where the base URL comes from

`createDictionary` resolves the default `packBaseUrl` from its own
`import.meta.url`, so the packs are found both at a domain root and under a
project path such as `/MyLinguistics-site/`. A hard-coded `/dict/` would
404 on GitHub Pages project sites; pass `packBaseUrl` only to override it.
