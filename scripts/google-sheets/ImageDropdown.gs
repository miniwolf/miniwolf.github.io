function imageProperties_() {
  return PropertiesService.getDocumentProperties();
}

function boundImageSpreadsheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open the bound club spreadsheet before running this function.');
  const configured = imageProperties_().getProperty('CLUB_IMAGE_SPREADSHEET_ID');
  if (configured && configured !== spreadsheet.getId()) throw new Error('This script is configured for a different spreadsheet.');
  return spreadsheet;
}

function imageHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(value => String(value).trim());
}

function imageColumns_(headers) {
  const columns = {};
  const names = { image: 'image', imageChoice: 'image_choice', imagePreview: 'image_preview' };
  Object.keys(names).forEach(key => {
    const positions = headers.map((header, index) => header === names[key] ? index + 1 : 0).filter(Boolean);
    if (positions.length > 1) throw new Error('Duplicate header: ' + names[key]);
    columns[key] = positions[0] || 0;
  });
  if (!columns.image) throw new Error('The instructors tab must have one image header in row 1.');
  return columns;
}

function imageSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('instructors');
  if (!sheet) throw new Error('The spreadsheet needs an instructors tab.');
  imageColumns_(imageHeaders_(sheet));
  return sheet;
}

function withImageLock_(action) {
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(10000)) throw new Error('Image tools are busy. Try again shortly.');
  try {
    return action();
  } finally {
    lock.releaseLock();
  }
}

function checkImageHelpers_(spreadsheet, sheet) {
  const properties = imageProperties_();
  const columns = imageColumns_(imageHeaders_(sheet));
  const owned = properties.getProperty('CLUB_IMAGE_INSTRUCTORS_ID') === String(sheet.getSheetId());
  if (!owned) {
    for (const column of [columns.imageChoice, columns.imagePreview].filter(Boolean)) {
      if (sheet.getLastRow() > 1 && sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getValues().some(row => row[0] !== '')) {
        throw new Error('Existing helper content is not owned by image tools. Rename those columns before setup.');
      }
    }
  }
  const catalog = spreadsheet.getSheetByName('_drive_images');
  if (catalog && (properties.getProperty('CLUB_IMAGE_CATALOG_ID') !== String(catalog.getSheetId()) ||
      imageHeaders_(catalog).join('|') !== 'label|file_id|url')) {
    throw new Error('The existing _drive_images tab is not owned by image tools. Rename it before setup.');
  }
}

function appendImageHelpers_(sheet) {
  let columns = imageColumns_(imageHeaders_(sheet));
  for (const [key, header] of [['imageChoice', 'image_choice'], ['imagePreview', 'image_preview']]) {
    if (columns[key]) continue;
    const target = sheet.getLastColumn() + 1;
    if (target > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), 1);
    sheet.getRange(1, target).setValue(header);
    columns = imageColumns_(imageHeaders_(sheet));
  }
  if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(1, 1);
  return columns;
}

function applyImageCatalog_(spreadsheet, records) {
  const sheet = imageSheet_(spreadsheet);
  checkImageHelpers_(spreadsheet, sheet);
  const columns = appendImageHelpers_(sheet);
  const catalog = spreadsheet.getSheetByName('_drive_images') || spreadsheet.insertSheet('_drive_images');
  const neededRows = Math.max(2, records.length + 1);
  if (catalog.getMaxRows() < neededRows) catalog.insertRowsAfter(catalog.getMaxRows(), neededRows - catalog.getMaxRows());
  catalog.getRange(1, 1, catalog.getMaxRows(), 3).clearContent();
  catalog.getRange(1, 1, 1, 3).setValues([['label', 'file_id', 'url']]);
  if (records.length) {
    catalog.getRange(2, 1, records.length, 3).setNumberFormat('@').setValues(
      records.map(record => [record.label, record.fileId, record.url]));
  }
  const choices = sheet.getRange(2, columns.imageChoice, sheet.getMaxRows() - 1, 1);
  if (records.length) {
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInRange(catalog.getRange(2, 1, records.length, 1), true)
      .setAllowInvalid(false).build();
    choices.setDataValidation(validation);
  } else {
    choices.clearDataValidations();
  }
  const reference = 'RC[' + (columns.image - columns.imagePreview) + ']';
  const preview = '=IF(' + reference + '="","",IFERROR(IMAGE(' + reference + '),"Preview unavailable"))';
  sheet.getRange(2, columns.imagePreview, sheet.getMaxRows() - 1, 1).setFormulaR1C1(preview);
  sheet.getRange(1, columns.imageChoice).setNote(records.length ? 'Choose a public Drive image. Refresh images after adding files.' : 'No eligible public images. Check the folder and sharing settings, then refresh.');
  catalog.hideSheet();
  imageProperties_().setProperties({
    CLUB_IMAGE_INSTRUCTORS_ID: String(sheet.getSheetId()),
    CLUB_IMAGE_CATALOG_ID: String(catalog.getSheetId()),
    CLUB_IMAGE_SPREADSHEET_ID: spreadsheet.getId()
  });
  spreadsheet.toast(records.length ? 'Image dropdown refreshed: ' + records.length + ' images.' : 'No eligible public images. Existing image URLs were preserved.', 'Club images');
}

function registerImageTriggers_(spreadsheet) {
  const handlers = ['onClubImageChoiceEdit', 'refreshClubImages'];
  handlers.forEach(handler => {
    const existing = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === handler);
    existing.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
    if (existing.length) return;
    const builder = ScriptApp.newTrigger(handler);
    if (handler === 'onClubImageChoiceEdit') builder.forSpreadsheet(spreadsheet).onEdit().create();
    else builder.timeBased().everyDays(1).atHour(6).create();
  });
}

function setupClubImages() {
  const spreadsheet = boundImageSpreadsheet_();
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Club images', 'Enter the shared root folder ID or a direct club subfolder ID (not its URL).', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const folderId = answer.getResponseText().trim();
  checkImageHelpers_(spreadsheet, imageSheet_(spreadsheet));
  const records = listImageCatalog_(folderId);
  withImageLock_(() => {
    applyImageCatalog_(spreadsheet, records);
    imageProperties_().setProperty('CLUB_IMAGE_FOLDER_ID', folderId);
    registerImageTriggers_(spreadsheet);
  });
  addClubImageMenu();
}

function refreshClubImages() {
  const spreadsheet = boundImageSpreadsheet_();
  const folderId = imageProperties_().getProperty('CLUB_IMAGE_FOLDER_ID');
  if (!folderId) throw new Error('Run setupClubImages first to configure the folder.');
  checkImageHelpers_(spreadsheet, imageSheet_(spreadsheet));
  const records = listImageCatalog_(folderId);
  withImageLock_(() => {
    if (imageProperties_().getProperty('CLUB_IMAGE_FOLDER_ID') !== folderId) throw new Error('The configured folder changed. Refresh again.');
    applyImageCatalog_(spreadsheet, records);
  });
}

function addClubImageMenu() {
  SpreadsheetApp.getUi().createMenu('Club images').addItem('Refresh images', 'refreshClubImages').addToUi();
}

function selectedCatalogImage_(spreadsheet, label) {
  const catalog = spreadsheet.getSheetByName('_drive_images');
  if (!catalog || imageProperties_().getProperty('CLUB_IMAGE_CATALOG_ID') !== String(catalog.getSheetId()) ||
      imageHeaders_(catalog).join('|') !== 'label|file_id|url' || catalog.getLastRow() < 2) {
    throw new Error('Image catalog is missing or changed. Run setupClubImages or refresh images.');
  }
  const matches = catalog.getRange(2, 1, catalog.getLastRow() - 1, 3).getValues().filter(row => row[0] === label);
  if (matches.length !== 1) throw new Error('Unknown or duplicate image choice. Refresh images and choose again.');
  return matches[0][1];
}

function onClubImageChoiceEdit(event) {
  if (!event || !event.range || !event.source) return;
  const range = event.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== 'instructors' || range.getRow() < 2) return;
  try {
    const properties = imageProperties_();
    if (properties.getProperty('CLUB_IMAGE_SPREADSHEET_ID') !== event.source.getId() ||
        properties.getProperty('CLUB_IMAGE_INSTRUCTORS_ID') !== String(sheet.getSheetId())) {
      throw new Error('Run setupClubImages for this spreadsheet before choosing images.');
    }
    const columns = imageColumns_(imageHeaders_(sheet));
    if (range.getColumn() !== columns.imageChoice) return;
    if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) throw new Error('Choose one image in one dropdown cell at a time.');
    const label = range.getValue();
    if (!label) return;
    if (event.value !== String(label)) throw new Error('The image choice changed; select it again.');
    const target = sheet.getRange(range.getRow(), columns.image);
    const previous = target.getValue();
    const previousFormula = target.getFormula();
    const folderId = properties.getProperty('CLUB_IMAGE_FOLDER_ID');
    const fileId = selectedCatalogImage_(event.source, label);
    const record = requirePublicImage_(fileId, folderId);
    withImageLock_(() => {
      const current = imageColumns_(imageHeaders_(sheet));
      if (JSON.stringify(current) !== JSON.stringify(columns) || range.getValue() !== label ||
          target.getValue() !== previous || target.getFormula() !== previousFormula ||
          properties.getProperty('CLUB_IMAGE_FOLDER_ID') !== folderId ||
          selectedCatalogImage_(event.source, label) !== fileId) {
        throw new Error('This row or its selection changed while checking the image. Choose again.');
      }
      if (!target.canEdit()) throw new Error('The image cell is protected. Its URL was not changed.');
      target.setValue(record.url);
      range.setNote('Image URL updated. The published CSV may take a little time to refresh.');
    });
  } catch (error) {
    event.source.toast(error.message, 'Club images');
    console.warn('Club image selection failed: ' + error.message);
  }
}