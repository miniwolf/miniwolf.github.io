# Windows Setup:

1. Download and install a Ruby+Devkit (use the default): https://rubyinstaller.org/downloads/
	1. Run the `ridk install` step on the last stage of the installation wizard.
	2. From the options choose MSYS2 and MINGW development toolchain.
2. Open a new command prompt window
3. Go to the project using `cd '/path/to/your/folder'`
3. Install Jekyll and Bundler using `gem install jekyll bundler`
4. run `bundle exec jekyll serve`
5. Open your browser on: http://localhost:4000

**Note**: It might be that you need to run some of these commands as an administrator

# Unix Setup:
1. Download and install Ruby: `sudo apt-get install ruby-full build-essential zlib1g-dev`
2. Setup Gem install directory:
	- `echo '# Install Ruby Gems to ~/gems' >> ~/.bashrc`
	- `echo 'export GEM_HOME="$HOME/gems"' >> ~/.bashrc`
	- `echo 'export PATH="$HOME/gems/bin:$PATH"' >> ~/.bashrc`
	- `source ~/.bashrc`
3. run `bundle install`
4. run `bundle exec jekyll serve`
5. Open your browser on: http://localhost:4000

# Club Content in Google Sheets

Club editors can maintain all structured club content in **one Google Sheets
file per club, each with seven separate tabs**. Each club controls its own
contact details and Google Form configuration. The importer updates Danish and
English page front matter and `_data/locations.yml`; no template migration is
needed. Page URLs, layout metadata and custom HTML contact/signup blocks remain
in Git and are preserved. Once configured, the **Sync clubs** GitHub Action runs
hourly and can also be started manually. It commits only actual data changes.

## Initial Setup

1. Export the current content with Ruby:
	```sh
	ruby scripts/clubs_to_csv.rb ../club-sheets
	```
2. The export creates folders `aarhus`, `aarhus-qi` and `lyngby`, each containing
	seven CSVs, plus a `sources.json` configuration file in the output directory.
	Create a separate Google spreadsheet for each club. Import only the CSVs
	from that club's folder, each as a **new sheet**
	using File -> Import -> Upload -> Insert new sheet(s). Name the seven tabs
	`clubs`, `locations`, `instructors`, `schedules`, `class_types`, `pricing`,
	and `faqs`. Do not replace the entire spreadsheet on subsequent imports.
3. Keep club ID, phone, price, time, URL and form-field columns formatted as **Plain
	text**. When importing, disable conversion of text to numbers, dates and
	formulas. Otherwise Sheets can change values such as phone numbers or times.
4. In each club's spreadsheet, under File -> Share -> Publish to web, publish
	**each of the seven tabs** as
	CSV, with automatic republishing enabled. Each tab has its own CSV URL;
	publishing the spreadsheet as HTML is not sufficient.
5. Use the generated `sources.json` as the configuration template. It maps
	`aarhus`, `aarhus-qi` and `lyngby` to their seven tabs. Replace each local
	CSV path with that club tab's published CSV URL, keeping every key.
	In repository Settings -> Secrets and variables -> Actions, add one secret
	named `CLUBS_SHEETS_CONFIG` containing the entire resulting JSON document.
	All three spreadsheets must be configured; the job validates them all
	before writing any files. The previous seven `CLUBS_*_CSV_URL` secrets are
	no longer used.

6. The job reuses `EVENTS_SYNC_TOKEN` unless `CLUBS_SYNC_TOKEN` is set. The token
	needs repository Contents read/write permission and its owner must be on the
	`main` ruleset bypass list, just like the events job. Using a personal access
	token also allows the push to trigger the normal GitHub Pages build.
7. Run **Actions -> Sync clubs -> Run workflow** and check the resulting commit.

Published tabs are public. Include only public club content and public Google
Form configuration, never contact submissions, member lists or credentials.

## Tab Columns

Keep every exported header, even when its cells are empty. Translated columns
use `da_` and `en_` prefixes. Hyphens in YAML field names become underscores in
CSV headers, such as `club_name` and `contact_name_id`.

| Tab | Columns |
| --- | --- |
| clubs | Shared: `club_id`, `club_name`; per language: `description`, `intro`, `interests`, `mailerlite_form` |
| locations | `address`, `address_link`, `phone`, `email`, `club_contact`, `contact_name_id`, `contact_email_id`, `contact_interest_id`, `contact_content_id` |
| instructors | Shared: `present`, `name`, `start`, `image`; per language: `descriptions` |
| schedules | Shared: `present`, `times`; per language: `title`, `days` |
| class_types | Shared: `present`; per language: `name`, `descriptions`, `perfect_for` |
| pricing | Shared: `present`, `price`, `featured`, `cta_link`; per language: `name`, `suffix`, `detail`, `descriptions`, `cta` |
| faqs | Shared: `present`; per language: `q`, `a` |

Each spreadsheet's `clubs` tab contains exactly one row. Its `club_id` is the
existing page filename without `.html`: `aarhus`, `aarhus-qi` or `lyngby`.
The `locations` tab also contains exactly one row, belonging to that club.
Other tabs need no `club_id` column because their spreadsheet identifies the
club. Do not put another club's content in these tabs. Adding a new club/page
is still a repository change, not a sheet operation.

Instructors, schedules, class types, prices and FAQs do not need row IDs.
Rows are rendered in sheet order; rearrange rows to reorder items. If you
already imported an earlier export, you can delete its `item_id` columns;
leaving those legacy columns in place is also harmless because they are ignored.
The Google Form field IDs in `locations` are still required for submission.

For child tabs, the shared `present` column must be `TRUE` or `FALSE`.
`TRUE` includes a row in both languages and requires its translated content.
`FALSE` hides it in both languages; its content can stay in the spreadsheet
for later use. An item cannot appear in only one language. Shared `featured`
is optional, but must be `TRUE` or `FALSE` when supplied. Instructor `start`
is a four-digit year. Shared values are applied to both page translations.

Use **one entry per line in a cell** for `interests`, instructor/class/pricing
`descriptions`, and schedule `days` and `times`. Each schedule row represents
one titled group: the first day matches the first time, the second matches the
second, and so on. Both `da_days` and `en_days` must have the same nonzero
number of entries as shared `times`. Existing
HTML such as `<br />` in titles and addresses is retained. Image cells currently
use site paths; new image files must be added to Git or hosted at a public URL.

Each club needs a name, description, and at least one instructor, schedule,
class type and pricing item in **both** languages. FAQs and introductions are
optional. Empty optional scalar cells remove that value. Missing or invalid
tabs, incorrect club IDs, missing required values and empty
required sections stop the import before any file is written. Fix the sheet
and rerun the job; the last valid site content stays in place.

## Migrating Existing Tabs

The importer accepts old language-prefixed columns for newly shared fields
only when the Danish and English values agree. Conflicting values stop the
sync; resolve them by choosing the shared value rather than silently losing
one translation's data. If a shared column exists, it takes precedence over
its old prefixed columns, even when its cell is empty.

| Tab | Replace Paired Columns With |
| --- | --- |
| clubs | `da_club_name` / `en_club_name` -> `club_name` |
| all child tabs | `da_present` / `en_present` -> `present` |
| instructors | `da_name` / `en_name` -> `name`; likewise `start` and `image` |
| schedules | `da_times` / `en_times` -> `times` |
| pricing | `da_price` / `en_price` -> `price`; likewise `featured` and `cta_link` |

Keep the other translated columns. Rename one old column to the new shared
name, set its intended values, then remove the redundant language columns.
Google Sheets checkboxes can be used for `present` and `featured` if they
export `TRUE` / `FALSE`.

To inspect the new CSV templates without overwriting existing CSVs or your
configured published URLs, export to a separate directory:

```sh
ruby scripts/clubs_to_csv.rb ../club-sheets-shared
```

The exporter requires shared values and item counts to agree across existing
page translations. It reports any conflict before writing any CSVs.

## Contact Forms

The `locations` tab holds the Google Form `formResponse` URL in `club_contact`
and its four `entry.<number>` field IDs. The `clubs` tab holds translated topic
choices in `interests`. The form HTML and submission logic remain in Git.
Each spreadsheet owns its contact configuration independently. Aarhus Tai Chi
and Aarhus Qigong initially receive copies of the same current details, but
changing either spreadsheet does not change the other club's contacts.
Club-specific differences are stored as `contact` overrides in page front
matter. The main Aarhus and Lyngby spreadsheets also update their respective
venue entries used by the home/about pages; Qigong does not add a duplicate
venue listing. Existing page `location` metadata and URLs stay unchanged.
Lyngby's custom signup HTML is preserved and continues to take precedence over
its Google Form configuration. Changing the displayed email does not
change Google Forms notification recipients; manage those in Google Forms.

## Drive Image Dropdown

Club editors can choose an instructor image from a filename dropdown directly
in their spreadsheet. A neighboring preview shows the selection. The script
writes a **literal image URL** into the existing `image` column, which the
published CSV and sync job read normally. No menu is needed to select images.

### Owner Setup

1. In the [shared image folder](https://drive.google.com/drive/folders/1KEGgP4AyFXwQqtrwNN5bJbGnwPv2qVR7),
	create a direct child folder for each club, or use the shared root itself.
	Upload the intended website images and grant public viewer access to those
	images. The script never changes sharing permissions. Files requiring a
	Drive resource key are not supported.
2. Open that club's spreadsheet, then **Extensions -> Apps Script**. Add script
	files named `DriveImages` and `ImageDropdown`, using the contents of
	[DriveImages.gs](scripts/google-sheets/DriveImages.gs) and
	[ImageDropdown.gs](scripts/google-sheets/ImageDropdown.gs).
3. In the Apps Script editor, enable **Services -> Add a service -> Drive API**,
	version **v3**. If this script uses a custom Google Cloud project, enable
	the Drive API in that project too.
4. Under **Project Settings**, enable showing the manifest file, then configure
	`appsscript.json` using [the supplied manifest](scripts/google-sheets/appsscript.json).
	For a new bound script, use it as supplied. For an existing project, merge
	its scopes and Drive dependency without deleting unrelated services or
	settings. The script reads Drive files, verifies public image URLs, edits
	the bound spreadsheet, and installs its own triggers; it cannot upload
	files or change their sharing permissions.
5. As the designated trigger owner, run **`setupClubImages`**, authorize the
	requested permissions, and enter the club folder ID from its Drive URL.
	The shared root ID is `1KEGgP4AyFXwQqtrwNN5bJbGnwPv2qVR7`. Only that root or
	one direct child is allowed; nested grandchildren are not searched.
6. Setup adds `image_choice` and `image_preview` to `instructors`, creates the
	`_drive_images` helper tab, and registers an edit trigger plus a daily
	refresh around 06:00 Copenhagen time. It preserves all existing `image`
	values. Re-running setup as the same owner does not duplicate triggers.
	Use just one designated owner: Google does not expose another user's
	installed triggers for deduplication.
7. For the optional refresh menu to reappear when the spreadsheet opens, add
	the call below to your existing `onOpen` handler. If there is no handler,
	add this function. Do not replace another script's existing handler:
	```javascript
	function onOpen() {
	  addClubImageMenu();
	}
	```

The files in this repository do not install themselves into Google Sheets.
Authorization and installation must be completed in each club's bound script.
Installed triggers run as their owner, so choose an owner who retains access
to the folder. Keep that owner's Drive access as limited as practical.

### Selecting And Refreshing Images

In `instructors`, choose a filename under `image_choice`. Each label includes
the file ID so duplicate filenames remain distinct. The script rechecks that
the selected file is a publicly readable image in the configured folder,
then updates that row's `image` URL and preview. Filenames are listed as text;
the native dropdown itself does not contain thumbnails.

Clearing a dropdown choice leaves the existing URL alone. Invalid selections,
multi-cell pastes, private/deleted images, moved headers during processing and
network failures do not overwrite the previous URL. Check the spreadsheet
notification or Apps Script **Executions** for errors. Protected `image` cells
must be writable by the trigger owner. The helper columns may be moved, but
keep their unique first-row headers unchanged.

After adding images, use **Club images -> Refresh images**, run
`refreshClubImages` in Apps Script, or wait for the daily refresh. Only images
directly inside the configured folder are listed. Failed requests preserve
the last valid catalog. A successfully refreshed empty folder removes the
dropdown's choices but does not erase existing image URLs. Daily trigger
availability and the preview must be checked in the actual bound spreadsheet;
a missing bound context causes a safe error instead of opening another file.

The helper tab `_drive_images` must **not** be published or added to
`sources.json`. It is hidden for convenience, not as an access-control measure.
The ordinary `instructors` CSV may contain `image_choice` and `image_preview`;
the importer ignores them and reads only the resolved `image` value.

An existing `/images/...` path remains valid on the website, although Sheets
cannot preview that relative path. Drive previews can also fail independently
of the URL; the preview cell then displays `Preview unavailable`. Drive is not
a guaranteed static-image host: deleted files, permission changes or hosting
limits can break links. No image copies are downloaded into this repository.

Before considering setup complete, select one public image, confirm the
preview and literal URL, inspect the published CSV after Google republishes
it, run the club sync, and verify the site image without Google sign-in.
Do not store credentials or private/member images in published content.

## Local Verification

```sh
ruby scripts/test_club_sheets.rb
```

The Drive dropdown logic also has local tests using explicit Google service
doubles; these do not authorize or modify any real spreadsheet:

```sh
node --test scripts/google-sheets/image-dropdown.test.cjs
```

The generated `sources.json` contains local CSV paths for offline verification.
Before replacing those paths with published URLs, run:

```sh
ruby scripts/sheet_to_clubs.rb ../club-sheets/sources.json
```

Without a filename argument, the importer reads the JSON from
`CLUBS_SHEETS_CONFIG`, as the GitHub Action does.

An untouched export/import leaves every existing file byte-for-byte unchanged.
After enabling the sheet sync, edit structured club content in the spreadsheet
rather than directly in the generated page front matter or locations data.