# Civil frame-and-cover catalog pilot

See the [sample structure schedule](sample/structure-schedule.md) and its
[synthetic cut sheet](sample/cut-sheet.md).

Run from the repository root with the existing dependencies installed.

```sh
node tools/reference/civil-cover-catalog/run.mjs
```

The structured synthetic cut sheet in `cut-sheet.json` supplies both product
variants. The runner embeds that data into `install.ts`, seeds the existing
synthetic civil site, and uses the core MCP script preview, check and apply
tools. The isolated fixture automatically approves the checked edit.

The script saves both types into the model and places the gasket variant
`ECC-FC600-G` at MH1. The frame-and-cover part sits with its top at the modeled
rim elevation. The assembly is linked to MH1 in the schedule by its structure
mark. Placement is coordinate based and will require repositioning if MH1
moves. The two variants share simplified geometry, with the gasket option
represented in the product specifications. The source supplies no load rating.

The native schedule view **Storm structure schedule · frame and cover** lists
the installed part by structure mark. The script reports the row from the
schedule engine during preview. The runner saves it after applying the
checked edit and verifies the installed type and original network records.

Outputs under `mutinybim-examples/civil-cover-catalog/` include:

- `cut-sheet.md` for the human-readable synthetic product sheet.
- `structure-schedule.md` for the installed assembly and cited specifications.
- `structure-schedule.json` for the schedule engine's raw rows.
- `site.model.json` for the model containing both types, the installed part
  and its schedule view.
- `install.generated.ts` for the runnable script with the sheet embedded.
