const CLUB_IMAGES_ROOT = '1KEGgP4AyFXwQqtrwNN5bJbGnwPv2qVR7';
const CLUB_IMAGE_FIELDS = 'id,name,mimeType,parents,trashed,resourceKey,driveId';

function validDriveId_(fileId) {
  if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    throw new Error('Use a valid Drive folder or file ID, not its sharing URL.');
  }
  return fileId;
}

function driveImageMetadata_(fileId) {
  return Drive.Files.get(validDriveId_(fileId), {
    supportsAllDrives: true,
    fields: CLUB_IMAGE_FIELDS
  });
}

function validateImageFolder_(folderId) {
  const root = driveImageMetadata_(CLUB_IMAGES_ROOT);
  const folder = folderId === CLUB_IMAGES_ROOT ? root : driveImageMetadata_(folderId);
  for (const entry of [root, folder]) {
    if (entry.trashed || entry.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('The configured source and root must be accessible Drive folders.');
    }
  }
  if (folderId !== CLUB_IMAGES_ROOT && !(folder.parents || []).includes(CLUB_IMAGES_ROOT)) {
    throw new Error('Choose the shared root folder or one of its direct child folders.');
  }
  return folder;
}

function publicImageUrl_(fileId) {
  return 'https://lh3.googleusercontent.com/d/' + validDriveId_(fileId);
}

function ineligibleImage_(message) {
  const error = new Error(message);
  error.ineligibleImage = true;
  return error;
}

function requirePublicImage_(fileId, folderId) {
  validateImageFolder_(folderId);
  const file = driveImageMetadata_(fileId);
  if (file.trashed || !String(file.mimeType || '').startsWith('image/') ||
      !(file.parents || []).includes(folderId) || file.resourceKey) {
    throw ineligibleImage_('Choose a public image directly inside the configured folder, without a required resource key.');
  }
  const url = publicImageUrl_(file.id);
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { Range: 'bytes=0-4095' }
  });
  const status = response.getResponseCode();
  if (status === 429 || status >= 500) {
    throw new Error('Image hosting temporarily failed (HTTP ' + status + '); try refreshing later.');
  }
  const headers = response.getAllHeaders();
  const typeKey = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
  const contentType = typeKey ? String(headers[typeKey]).toLowerCase() : '';
  if (![200, 206].includes(status) || !contentType.startsWith('image/')) {
    throw ineligibleImage_('The image is not publicly readable. Check its sharing settings; no permissions were changed.');
  }
  return { fileId: file.id, name: String(file.name || file.id), url: url };
}

function listImageCatalog_(folderId) {
  const folder = validateImageFolder_(folderId);
  const options = {
    q: "'" + validDriveId_(folderId) + "' in parents and trashed = false and mimeType contains 'image/'",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 100,
    fields: 'nextPageToken,incompleteSearch,files(' + CLUB_IMAGE_FIELDS + ')'
  };
  if (folder.driveId) {
    options.corpora = 'drive';
    options.driveId = folder.driveId;
  }
  const records = [];
  const seenTokens = new Set();
  const seenFiles = new Set();
  let skipped = 0;
  do {
    const page = Drive.Files.list(options);
    if (page.incompleteSearch) throw new Error('Drive returned an incomplete catalog; the previous catalog was kept.');
    for (const file of page.files || []) {
      if (seenFiles.has(file.id)) continue;
      seenFiles.add(file.id);
      try {
        const record = requirePublicImage_(file.id, folderId);
        record.label = 'Photo: ' + record.name + ' [' + record.fileId + ']';
        records.push(record);
      } catch (error) {
        if (!error.ineligibleImage) throw error;
        skipped += 1;
      }
    }
    options.pageToken = page.nextPageToken;
    if (options.pageToken && seenTokens.has(options.pageToken)) {
      throw new Error('Drive repeated a pagination token; refresh was stopped.');
    }
    seenTokens.add(options.pageToken);
  } while (options.pageToken);
  records.sort((first, second) => first.name.localeCompare(second.name) || first.fileId.localeCompare(second.fileId));
  console.log('Image catalog: ' + records.length + ' public images, ' + skipped + ' ineligible files skipped.');
  return records;
}