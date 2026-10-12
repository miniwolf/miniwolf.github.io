const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = '1KEGgP4AyFXwQqtrwNN5bJbGnwPv2qVR7';
const FOLDER = { id: 'club_folder', mimeType: 'application/vnd.google-apps.folder', parents: [ROOT] };

function loadScripts(files, services = {}) {
  const context = vm.createContext({ console, ...services });
  for (const file of files) {
    const filename = path.join(__dirname, file);
    assert.ok(fs.existsSync(filename), `${file} has not been implemented`);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename: file });
  }
  return context;
}

function image(id, extra = {}) {
  return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', parents: ['club_folder'], ...extra };
}

function driveServices(files = {}, pages = [{ files: [] }], response = {}) {
  return {
    Drive: { Files: {
      get(id) {
        if (id === ROOT) return { id, mimeType: FOLDER.mimeType };
        if (id === 'club_folder') return FOLDER;
        if (!files[id]) throw new Error('File not found');
        return files[id];
      },
      list(options) {
        const index = options.pageToken ? Number(options.pageToken) : 0;
        const page = pages[index];
        if (page instanceof Error) throw page;
        assert.equal(options.supportsAllDrives, true);
        assert.equal(options.includeItemsFromAllDrives, true);
        return page;
      }
    } },
    UrlFetchApp: { fetch(url, options) {
      assert.ok(url.startsWith('https://lh3.googleusercontent.com/d/'));
      assert.equal(options.headers.Authorization, undefined);
      return {
        getResponseCode: () => response.status || 200,
        getAllHeaders: () => ({ 'Content-Type': response.type || 'image/jpeg' })
      };
    } }
  };
}

test('public image URL requires a valid file ID', () => {
  const context = loadScripts(['DriveImages.gs']);
  assert.equal(context.publicImageUrl_('photo_123'), 'https://lh3.googleusercontent.com/d/photo_123');
  assert.throws(() => context.publicImageUrl_('../invalid'));
});

test('folder restriction accepts only root and direct child folders', () => {
  const services = driveServices({
    unrelated: { ...FOLDER, id: 'unrelated', parents: ['elsewhere'] },
    deleted: { ...FOLDER, id: 'deleted', trashed: true },
    not_folder: image('not_folder', { parents: [ROOT] })
  });
  const context = loadScripts(['DriveImages.gs'], services);
  assert.equal(context.validateImageFolder_(ROOT).id, ROOT);
  assert.equal(context.validateImageFolder_('club_folder').id, 'club_folder');
  for (const id of ['unrelated', 'deleted', 'not_folder', "bad'query"]) {
    assert.throws(() => context.validateImageFolder_(id));
  }
});

test('only public images in the configured folder can be selected', () => {
  const files = {
    portrait: image('portrait'),
    other: image('other', { parents: ['somewhere_else'] }),
    protected: image('protected', { resourceKey: 'required' }),
    deleted: image('deleted', { trashed: true }),
    document: image('document', { mimeType: 'text/plain' })
  };
  const context = loadScripts(['DriveImages.gs'], driveServices(files));
  assert.equal(context.requirePublicImage_('portrait', 'club_folder').url, 'https://lh3.googleusercontent.com/d/portrait');
  for (const id of ['other', 'protected', 'deleted', 'document', 'missing']) {
    assert.throws(() => context.requirePublicImage_(id, 'club_folder'));
  }
  const login = loadScripts(['DriveImages.gs'], driveServices(files, [], { type: 'text/html' }));
  assert.throws(() => login.requirePublicImage_('portrait', 'club_folder'), /public|image/i);
});

test('catalog paginates and labels duplicate and formula-like filenames safely', () => {
  const files = {
    photo_b: image('photo_b', { name: 'portrait.jpg' }),
    photo_a: image('photo_a', { name: 'portrait.jpg' }),
    formula: image('formula', { name: '=IMPORTXML("bad")' })
  };
  const pages = [
    { files: [files.photo_b], nextPageToken: '1' },
    { files: [files.photo_a, files.formula] }
  ];
  const context = loadScripts(['DriveImages.gs'], driveServices(files, pages));
  const records = Array.from(context.listImageCatalog_('club_folder'));
  assert.deepEqual(records.map(record => record.fileId), ['formula', 'photo_a', 'photo_b']);
  assert.equal(new Set(records.map(record => record.label)).size, 3);
  assert.ok(records.every(record => record.label.startsWith('Photo: ')));
  assert.equal(records[1].label, 'Photo: portrait.jpg [photo_a]');
});

test('catalog excludes ineligible images but aborts transient and pagination failures', () => {
  const files = { private: image('private'), portrait: image('portrait') };
  const privateContext = loadScripts(['DriveImages.gs'], driveServices(files, [{ files: [files.private] }], { status: 403 }));
  assert.equal(privateContext.listImageCatalog_('club_folder').length, 0);
  const failedContext = loadScripts(['DriveImages.gs'], driveServices(files, [{ files: [files.portrait] }], { status: 503 }));
  assert.throws(() => failedContext.listImageCatalog_('club_folder'), /503|temporar/i);
  const pageFailure = loadScripts(['DriveImages.gs'], driveServices(files, [{ files: [], nextPageToken: '1' }, new Error('Quota exceeded')]));
  assert.throws(() => pageFailure.listImageCatalog_('club_folder'), /Quota/);
  const empty = loadScripts(['DriveImages.gs'], driveServices());
  assert.equal(empty.listImageCatalog_('club_folder').length, 0);
});

test('shared-drive folders restrict listing to that drive and reject incomplete results', () => {
  const services = driveServices();
  const get = services.Drive.Files.get;
  services.Drive.Files.get = id => id === 'club_folder' ? { ...FOLDER, driveId: 'team_drive' } : get(id);
  services.Drive.Files.list = options => {
    assert.equal(options.corpora, 'drive');
    assert.equal(options.driveId, 'team_drive');
    return { files: [], incompleteSearch: true };
  };
  const context = loadScripts(['DriveImages.gs'], services);
  assert.throws(() => context.listImageCatalog_('club_folder'), /incomplete/);
});

class MemoryRange {
  constructor(sheet, row, column, rows = 1, columns = 1) {
    Object.assign(this, { sheet, row, column, rows, columns });
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.column; }
  getNumRows() { return this.rows; }
  getNumColumns() { return this.columns; }
  getValue() { return this.getValues()[0][0]; }
  getValues() {
    return Array.from({ length: this.rows }, (_, rowOffset) =>
      Array.from({ length: this.columns }, (_, columnOffset) =>
        this.sheet.cells.get(`${this.row + rowOffset}:${this.column + columnOffset}`) ?? ''));
  }
  getFormula() { return this.sheet.formulas.get(`${this.row}:${this.column}`) || ''; }
  setValues(values) {
    values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
      const key = `${this.row + rowOffset}:${this.column + columnOffset}`;
      this.sheet.cells.set(key, value);
      this.sheet.formulas.delete(key);
    }));
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  clearContent() { return this.setValues(Array.from({ length: this.rows }, () => Array(this.columns).fill(''))); }
  setNote(note) { this.sheet.notes.set(`${this.row}:${this.column}`, note); return this; }
  setNumberFormat() { return this; }
  setDataValidation(rule) { this.sheet.validation = rule; return this; }
  clearDataValidations() { this.sheet.validation = null; return this; }
  setFormulaR1C1(formula) {
    for (let offset = 0; offset < this.rows; offset += 1) {
      this.sheet.formulas.set(`${this.row + offset}:${this.column}`, formula);
    }
    return this;
  }
  canEdit() { return this.sheet.editable !== false; }
}

class MemorySheet {
  constructor(name, id, rows) {
    Object.assign(this, { name, id, cells: new Map(), formulas: new Map(), notes: new Map(), maxRows: 10, maxColumns: 12 });
    if (rows.length) this.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getLastColumn() { return Math.max(0, ...Array.from(this.cells).filter(([, value]) => value !== '').map(([key]) => Number(key.split(':')[1]))); }
  getLastRow() { return Math.max(0, ...Array.from(this.cells).filter(([, value]) => value !== '').map(([key]) => Number(key.split(':')[0]))); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  insertRowsAfter(_after, count) { this.maxRows += count; }
  insertColumnsAfter(_after, count) { this.maxColumns += count; }
  getRange(...args) { return new MemoryRange(this, ...args); }
  hideSheet() { this.hidden = true; }
}

function sheetServices({ fresh = false, cancel = false, locked = false } = {}) {
  const sheets = new Map();
  const instructors = new MemorySheet('instructors', 1, fresh ? [
    ['name', 'image'], ['Instructor', '/images/original.jpg']
  ] : [
    ['name', 'image_choice', 'image_preview', 'image'],
    ['Instructor', 'Photo: portrait.jpg [portrait]', '', '/images/original.jpg'],
    ['Other instructor', '', '', '/images/other.jpg']
  ]);
  sheets.set('instructors', instructors);
  const properties = new Map(fresh ? [] : [
    ['CLUB_IMAGE_FOLDER_ID', 'club_folder'], ['CLUB_IMAGE_INSTRUCTORS_ID', '1'],
    ['CLUB_IMAGE_CATALOG_ID', '2'], ['CLUB_IMAGE_SPREADSHEET_ID', 'spreadsheet']
  ]);
  if (!fresh) sheets.set('_drive_images', new MemorySheet('_drive_images', 2, [
    ['label', 'file_id', 'url'],
    ['Photo: portrait.jpg [portrait]', 'portrait', 'https://untrusted.example/not-used.jpg']
  ]));
  const notices = [];
  const spreadsheet = {
    getId: () => 'spreadsheet',
    getSheetByName: name => sheets.get(name) || null,
    insertSheet(name) { const sheet = new MemorySheet(name, sheets.size + 1, []); sheets.set(name, sheet); return sheet; },
    toast: message => notices.push(message)
  };
  const triggers = [{ getHandlerFunction: () => 'unrelatedHandler' }];
  let releases = 0;
  const services = {
    ...driveServices({ portrait: image('portrait', { name: 'portrait.jpg' }) }, [{ files: [image('portrait')] }]),
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ({ Button: { OK: 'ok' }, ButtonSet: { OK_CANCEL: 'okcancel' },
        prompt: () => ({ getSelectedButton: () => cancel ? 'cancel' : 'ok', getResponseText: () => 'club_folder' }),
        createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }),
      newDataValidation: () => ({
        requireValueInRange(range) { this.range = range; return this; },
        setAllowInvalid(value) { this.allowInvalid = value; return this; },
        build() { return this; }
      })
    },
    PropertiesService: { getDocumentProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty(key, value) { properties.set(key, value); return this; },
      setProperties(values) { Object.entries(values).forEach(([key, value]) => properties.set(key, value)); return this; }
    }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => !locked, releaseLock() { releases += 1; } }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger(trigger) { triggers.splice(triggers.indexOf(trigger), 1); },
      newTrigger(handler) {
        return { forSpreadsheet() { return this; }, onEdit() { return this; }, timeBased() { return this; },
          everyDays() { return this; }, atHour() { return this; },
          create() { triggers.push({ getHandlerFunction: () => handler }); }
        };
      }
    }
  };
  const context = loadScripts(['DriveImages.gs', 'ImageDropdown.gs'], services);
  return { context, services, spreadsheet, instructors, sheets, properties, triggers, notices,
    releases: () => releases,
    event: () => ({ source: spreadsheet, range: instructors.getRange(2, 2), value: instructors.getRange(2, 2).getValue() }) };
}

test('image columns are resolved by unique headers', () => {
  const context = loadScripts(['ImageDropdown.gs']);
  const columns = context.imageColumns_(['name', 'image_preview', 'image', 'image_choice']);
  assert.equal(columns.image, 3);
  assert.equal(columns.imageChoice, 4);
  assert.equal(columns.imagePreview, 2);
  assert.throws(() => context.imageColumns_(['image', 'image', 'image_choice', 'image_preview']));
  assert.throws(() => context.imageColumns_(['name']));
});

test('dropdown writes the verified literal URL only to the edited row', () => {
  const fixture = sheetServices();
  fixture.context.onClubImageChoiceEdit(fixture.event());
  assert.equal(fixture.instructors.getRange(2, 4).getValue(), 'https://lh3.googleusercontent.com/d/portrait');
  assert.equal(fixture.instructors.getRange(2, 4).getFormula(), '');
  assert.equal(fixture.instructors.getRange(3, 4).getValue(), '/images/other.jpg');
  assert.equal(fixture.releases(), 1);
});

test('cleared, invalid, multi-cell, header and unrelated edits preserve image URLs', () => {
  for (const kind of ['cleared', 'invalid', 'multi', 'header', 'unrelated']) {
    const fixture = sheetServices();
    const event = fixture.event();
    if (kind === 'cleared') { event.range.setValue(''); event.value = ''; }
    if (kind === 'invalid') { event.range.setValue('unknown'); event.value = 'unknown'; }
    if (kind === 'multi') event.range = fixture.instructors.getRange(2, 2, 2, 1);
    if (kind === 'header') event.range = fixture.instructors.getRange(1, 2);
    if (kind === 'unrelated') event.range = fixture.instructors.getRange(2, 1);
    fixture.context.onClubImageChoiceEdit(event);
    assert.equal(fixture.instructors.getRange(2, 4).getValue(), '/images/original.jpg', kind);
  }
});

test('public validation failures and lock timeouts preserve existing images', () => {
  for (const kind of ['private', 'deleted', 'wrong_parent', 'locked', 'protected_cell', 'network']) {
    const fixture = sheetServices({ locked: kind === 'locked' });
    if (kind === 'protected_cell') fixture.instructors.editable = false;
    if (kind === 'network') fixture.services.UrlFetchApp.fetch = () => { throw new Error('Network unavailable'); };
    if (kind === 'private') fixture.services.UrlFetchApp.fetch = () => ({ getResponseCode: () => 403, getAllHeaders: () => ({}) });
    if (kind === 'deleted') fixture.services.Drive.Files.get = () => { throw new Error('Deleted'); };
    if (kind === 'wrong_parent') {
      const get = fixture.services.Drive.Files.get;
      fixture.services.Drive.Files.get = id => id === 'portrait' ? image(id, { parents: ['wrong'] }) : get(id);
    }
    fixture.context.onClubImageChoiceEdit(fixture.event());
    assert.equal(fixture.instructors.getRange(2, 4).getValue(), '/images/original.jpg', kind);
    assert.ok(fixture.notices.length || fixture.instructors.notes.size, kind);
  }
});

test('stale choices, manual destination edits and moved headers cannot be overwritten', () => {
  for (const kind of ['choice', 'destination', 'header']) {
    const fixture = sheetServices();
    const fetch = fixture.services.UrlFetchApp.fetch;
    fixture.services.UrlFetchApp.fetch = (...args) => {
      if (kind === 'choice') fixture.instructors.getRange(2, 2).setValue('new choice');
      if (kind === 'destination') fixture.instructors.getRange(2, 4).setValue('/manual.jpg');
      if (kind === 'header') fixture.instructors.getRange(1, 4).setValue('different');
      return fetch(...args);
    };
    fixture.context.onClubImageChoiceEdit(fixture.event());
    assert.equal(fixture.instructors.getRange(2, 4).getValue(), kind === 'destination' ? '/manual.jpg' : '/images/original.jpg');
  }
});

test('setup is idempotent and preserves existing images and unrelated triggers', () => {
  const fixture = sheetServices({ fresh: true });
  fixture.context.setupClubImages();
  fixture.context.setupClubImages();
  assert.equal(fixture.instructors.getRange(2, 2).getValue(), '/images/original.jpg');
  assert.equal(fixture.instructors.getRange(1, 3).getValue(), 'image_choice');
  assert.equal(fixture.instructors.getRange(1, 4).getValue(), 'image_preview');
  assert.deepEqual(fixture.triggers.map(trigger => trigger.getHandlerFunction()).sort(),
    ['onClubImageChoiceEdit', 'refreshClubImages', 'unrelatedHandler'].sort());
  assert.equal(fixture.instructors.validation.allowInvalid, false);
  assert.equal(fixture.sheets.get('_drive_images').getRange(2, 3).getValue(), 'https://lh3.googleusercontent.com/d/portrait');
  assert.match(fixture.instructors.getRange(2, 4).getFormula(), /IMAGE\(RC\[-2\]\)/);
});

test('cancelled setup and missing bound context do not change sheet data', () => {
  const fixture = sheetServices({ fresh: true, cancel: true });
  fixture.context.setupClubImages();
  assert.equal(fixture.instructors.getLastColumn(), 2);
  assert.equal(fixture.properties.size, 0);
  fixture.services.SpreadsheetApp.getActiveSpreadsheet = () => null;
  assert.throws(() => fixture.context.refreshClubImages(), /bound|spreadsheet/i);
  assert.equal(fixture.sheets.size, 1);
});

test('failed refresh preserves catalog, while empty refresh removes only dropdown choices', () => {
  const fixture = sheetServices();
  const catalog = fixture.sheets.get('_drive_images');
  const before = JSON.stringify(catalog.getRange(1, 1, 2, 3).getValues());
  fixture.services.Drive.Files.list = () => { throw new Error('Drive quota'); };
  assert.throws(() => fixture.context.refreshClubImages(), /quota/);
  assert.equal(JSON.stringify(catalog.getRange(1, 1, 2, 3).getValues()), before);
  fixture.services.Drive.Files.list = () => ({ files: [] });
  fixture.context.refreshClubImages();
  assert.equal(fixture.instructors.validation, null);
  assert.equal(fixture.instructors.getRange(2, 4).getValue(), '/images/original.jpg');
});

test('setup refuses to overwrite preexisting helper content', () => {
  const fixture = sheetServices({ fresh: true });
  fixture.instructors.getRange(1, 3).setValue('image_preview');
  fixture.instructors.getRange(2, 3).setValue('My content');
  assert.throws(() => fixture.context.setupClubImages(), /existing|owned|content/i);
  assert.equal(fixture.instructors.getRange(2, 3).getValue(), 'My content');
});

test('duplicate image triggers are removed without deleting unrelated triggers', () => {
  const fixture = sheetServices({ fresh: true });
  fixture.context.setupClubImages();
  fixture.triggers.push({ getHandlerFunction: () => 'refreshClubImages' });
  fixture.triggers.push({ getHandlerFunction: () => 'onClubImageChoiceEdit' });
  fixture.context.setupClubImages();
  assert.deepEqual(fixture.triggers.map(trigger => trigger.getHandlerFunction()).sort(),
    ['onClubImageChoiceEdit', 'refreshClubImages', 'unrelatedHandler'].sort());
});