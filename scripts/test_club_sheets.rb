require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'
require 'csv'
require 'yaml'

class ClubSheetsTest < Minitest::Test
  ROOT = File.expand_path('..', __dir__)

  def setup
    @root = Dir.mktmpdir('club-sheets')
    %w[da en _data].each { |dir| FileUtils.cp_r(File.join(ROOT, dir), @root) }
    @sheets = File.join(@root, 'sheets')
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def load_sync
    assert File.file?(File.join(__dir__, 'club_sheets.rb')), 'Club spreadsheet support is missing'
    require_relative 'club_sheets'
    ClubSheets.new(@root)
  end

  def snapshot
    Dir.glob(File.join(@root, '{da,en}', '*.html')).to_h { |path| [path, File.binread(path)] }
      .merge(File.join(@root, '_data', 'locations.yml') => File.binread(File.join(@root, '_data', 'locations.yml')))
  end

  def sources
    Dir.glob(File.join(@sheets, '*')).select { |path| File.directory?(path) }.to_h do |directory|
      [File.basename(directory), Dir.glob(File.join(directory, '*.csv')).to_h { |path| [File.basename(path, '.csv'), path] }]
    end
  end

  def edit_tab(tab, club_id = 'aarhus')
    path = File.join(@sheets, club_id, "#{tab}.csv")
    table = CSV.read(path, headers: true, encoding: 'bom|utf-8')
    yield table
    File.write(path, table.to_csv)
  end

  def test_export_import_preserves_all_existing_files_byte_for_byte
    sync = load_sync
    before = snapshot
    sync.export(@sheets)
    assert_equal %w[aarhus aarhus-qi lyngby], sources.keys.sort
    sources.each do |club_id, tabs|
      assert_equal 7, tabs.length
      clubs = CSV.read(tabs.fetch('clubs'), headers: true, encoding: 'bom|utf-8')
      assert_equal [club_id], clubs.map { |row| row['club_id'] }
    end
    assert_empty sync.sync(sources)
    assert_equal before, snapshot
  end

  def test_sheet_update_preserves_custom_contact_html_and_metadata
    sync = load_sync
    sync.export(@sheets)
    path = File.join(@root, 'da', 'lyngby.html')
    original = File.read(path)
    edit_tab('clubs', 'lyngby') { |table| table[0]['da_intro'] = 'Updated introduction' }
    assert_equal [path], sync.sync(sources)
    updated = File.read(path)
    assert_equal original.split(/^---\s*$\r?\n/, 3).last, updated.split(/^---\s*$\r?\n/, 3).last
    data = YAML.safe_load(updated.split(/^---\s*$\r?\n/, 3)[1])
    assert_equal 'Updated introduction', data['intro']
    assert_equal '/en/lyngby/', data['alt_url_en']
    assert_equal 'club', data['layout']
    assert_empty sync.sync(sources)
  end

  def assert_rejected(tab)
    sync = load_sync
    sync.export(@sheets)
    before = snapshot
    edit_tab(tab) { |table| yield table }
    assert_raises(RuntimeError) { sync.sync(sources) }
    assert_equal before, snapshot
  end

  def test_empty_required_section_cannot_wipe_live_content
    assert_rejected('instructors') { |table| table.delete_if { true } }
  end

  def test_invalid_late_tab_leaves_earlier_updates_unwritten
    sync = load_sync
    sync.export(@sheets)
    before = snapshot
    edit_tab('clubs') { |table| table[0]['da_intro'] = 'Must not be written' }
    edit_tab('faqs', 'lyngby') { |table| table[0]['en_a'] = '' }
    assert_raises(RuntimeError) { sync.sync(sources) }
    assert_equal before, snapshot
  end

  def test_duplicate_club_ids_are_rejected
    assert_rejected('clubs') { |table| table << table[0].dup }
  end

  def test_wrong_club_spreadsheet_is_rejected
    assert_rejected('clubs') { |table| table[0]['club_id'] = 'aarhus-qi' }
  end

  def test_missing_club_is_rejected
    assert_rejected('clubs') { |table| table.delete(0) }
  end

  def test_mismatched_schedule_days_and_times_are_rejected
    assert_rejected('schedules') { |table| table[0]['times'] = "18:00-19:00\n19:00-20:00" }
  end

  def test_invalid_boolean_is_rejected
    assert_rejected('pricing') { |table| table[0]['featured'] = 'perhaps' }
  end

  def test_invalid_form_configuration_is_rejected
    assert_rejected('locations') { |table| table[0]['contact_name_id'] = 'not-a-field' }
  end

  def test_missing_header_is_rejected
    sync = load_sync
    sync.export(@sheets)
    before = snapshot
    File.write(File.join(@sheets, 'aarhus', 'clubs.csv'), "club_id\naarhus\n")
    assert_raises(RuntimeError) { sync.sync(sources) }
    assert_equal before, snapshot
  end

  def test_failed_fetch_does_not_write_any_files
    sync = load_sync
    sync.export(@sheets)
    before = snapshot
    missing_sources = sources
    missing_sources['aarhus']['faqs'] = File.join(@sheets, 'missing.csv')
    assert_raises(Errno::ENOENT) { sync.sync(missing_sources) }
    assert_equal before, snapshot
  end

  def test_bilingual_schedule_price_and_contact_updates
    sync = load_sync
    sync.export(@sheets)
    edit_tab('schedules') { |table| table[0]['times'] = '17:00-18:00' }
    edit_tab('pricing') { |table| table[0]['price'] = '100 DKK' }
    edit_tab('locations') { |table| table[0]['phone'] = '+45 12345678' }
    sync.sync(sources)
    da = YAML.safe_load(File.read(File.join(@root, 'da', 'aarhus.html')).split(/^---\s*$\r?\n/, 3)[1])
    en = YAML.safe_load(File.read(File.join(@root, 'en', 'aarhus.html')).split(/^---\s*$\r?\n/, 3)[1])
    assert_equal '17:00-18:00', da['classes'][0]['descriptions'][0]['time']
    assert_equal '100 DKK', en['pricing'][0]['price']
    assert_equal '+45 12345678', YAML.safe_load_file(File.join(@root, '_data', 'locations.yml'))['aarhus']['phone']
    assert_empty sync.sync(sources)
  end

  def test_qigong_contact_change_does_not_change_tai_chi_or_venue_listing
    sync = load_sync
    sync.export(@sheets)
    before = snapshot
    edit_tab('locations', 'aarhus-qi') do |table|
      table[0]['email'] = 'qigong@example.com'
      table[0]['club_contact'] = 'https://docs.google.com/forms/d/e/qigong/formResponse'
    end
    changed = sync.sync(sources)
    assert_equal %w[da en].map { |language| File.join(@root, language, 'aarhus-qi.html') }.sort, changed.sort
    %w[da en].each do |language|
      path = File.join(@root, language, 'aarhus-qi.html')
      data = YAML.safe_load(File.read(path).split(/^---\s*$\r?\n/, 3)[1])
      assert_equal 'qigong@example.com', data['contact']['email']
      assert_equal 'https://docs.google.com/forms/d/e/qigong/formResponse', data['contact']['club-contact']
    end
    before.each { |path, bytes| assert_equal bytes, File.binread(path) unless changed.include?(path) }
    assert_empty sync.sync(sources)
  end

  def test_tai_chi_contact_change_does_not_change_qigong_contacts
    sync = load_sync
    sync.export(@sheets)
    original_email = YAML.safe_load_file(File.join(@root, '_data', 'locations.yml'))['aarhus']['email']
    edit_tab('locations') { |table| table[0]['email'] = 'tai-chi@example.com' }
    sync.sync(sources)
    %w[da en].each do |language|
      data = YAML.safe_load(File.read(File.join(@root, language, 'aarhus-qi.html')).split(/^---\s*$\r?\n/, 3)[1])
      assert_equal original_email, data.fetch('contact').fetch('email')
    end
    sync.export(@sheets)
    qigong = CSV.read(File.join(@sheets, 'aarhus-qi', 'locations.csv'), headers: true, encoding: 'bom|utf-8')
    assert_equal original_email, qigong[0]['email']
    assert_empty sync.sync(sources)
  end

  def test_missing_club_configuration_is_rejected
    sync = load_sync
    sync.export(@sheets)
    before = snapshot
    assert_raises(RuntimeError) { sync.sync(sources.reject { |club_id, _tabs| club_id == 'aarhus-qi' }) }
    assert_equal before, snapshot
  end

  def test_export_configuration_uses_portable_paths_relative_to_json_file
    sync = load_sync
    sync.export(@sheets)
    config = JSON.parse(File.read(File.join(@sheets, 'sources.json')))
    assert_equal 'aarhus/clubs.csv', config.fetch('aarhus').fetch('clubs')
    assert_equal 'aarhus-qi/locations.csv', config.fetch('aarhus-qi').fetch('locations')
  end

  def test_exports_do_not_require_item_ids
    sync = load_sync
    sync.export(@sheets)
    sources.each_value do |tabs|
      %w[instructors schedules class_types pricing faqs].each do |tab|
        table = CSV.read(tabs.fetch(tab), headers: true, encoding: 'bom|utf-8')
        refute_includes table.headers, 'item_id'
      end
    end
  end

  def test_import_without_item_ids_keeps_sheet_row_order
    sync = load_sync
    sync.export(@sheets)
    sources.each do |club_id, _tabs|
      %w[instructors schedules class_types pricing faqs].each do |tab|
        edit_tab(tab, club_id) { |table| table.delete('item_id') }
      end
    end
    edit_tab('pricing', 'lyngby') do |table|
      first = table.delete(0)
      table << first
    end
    sync.sync(sources)
    path = File.join(@root, 'da', 'lyngby.html')
    data = YAML.safe_load(File.read(path).split(/^---\s*$\r?\n/, 3)[1])
    assert_equal ['Halvårlig Kontingent', 'Gratis Prøvetime'], data['pricing'].map { |item| item['name'] }
    assert_empty sync.sync(sources)
  end

  def test_shared_fields_update_both_languages
    sync = load_sync
    sync.export(@sheets)
    edit_tab('clubs', 'lyngby') { |table| table[0]['club_name'] = 'Shared club name' }
    edit_tab('instructors', 'lyngby') do |table|
      table[0]['name'] = 'Shared instructor name'
      table[0]['start'] = '2004'
      table[0]['image'] = '/images/lyngby/shared.jpg'
    end
    edit_tab('schedules', 'lyngby') { |table| table[0]['times'] = "18:00-19:00\n18:00-19:00" }
    edit_tab('pricing', 'lyngby') do |table|
      table[0]['price'] = '100 DKK'
      table[0]['featured'] = 'FALSE'
      table[0]['cta_link'] = 'https://example.com/signup'
    end
    sync.sync(sources)
    %w[da en].each do |language|
      data = YAML.safe_load(File.read(File.join(@root, language, 'lyngby.html')).split(/^---\s*$\r?\n/, 3)[1])
      assert_equal 'Shared club name', data['club-name']
      assert_equal 'Shared instructor name', data['instructors'][0]['name']
      assert_equal 2004, data['instructors'][0]['start']
      assert_equal '/images/lyngby/shared.jpg', data['instructors'][0]['image']
      assert_equal ['18:00-19:00', '18:00-19:00'], data['classes'][0]['descriptions'].map { |slot| slot['time'] }
      assert_equal '100 DKK', data['pricing'][0]['price']
      assert_equal false, data['pricing'][0]['featured']
      assert_equal 'https://example.com/signup', data['pricing'][0]['cta_link']
    end
    assert_empty sync.sync(sources)
  end

  def test_shared_present_hides_populated_row_in_both_languages
    sync = load_sync
    sync.export(@sheets)
    edit_tab('instructors', 'lyngby') { |table| table[0]['present'] = 'FALSE' }
    sync.sync(sources)
    %w[da en].each do |language|
      data = YAML.safe_load(File.read(File.join(@root, language, 'lyngby.html')).split(/^---\s*$\r?\n/, 3)[1])
      assert_equal ['Nicklas Arenth Pingel'], data['instructors'].map { |item| item['name'] }
    end
  end

  def test_export_uses_only_shared_columns_for_nontranslated_values
    sync = load_sync
    sync.export(@sheets)
    tabs = sources.fetch('lyngby')
    instructors = CSV.read(tabs['instructors'], headers: true, encoding: 'bom|utf-8')
    assert_equal %w[present name start image da_descriptions en_descriptions], instructors.headers
    assert_equal 'Casper Clausen', instructors[0]['name']
    pricing = CSV.read(tabs['pricing'], headers: true, encoding: 'bom|utf-8')
    assert_equal 'TRUE', pricing[0]['featured']
    refute_includes pricing.headers, 'da_present'
    refute_includes pricing.headers, 'en_featured'
  end

  def test_legacy_presence_flags_cannot_hide_one_language_only
    assert_rejected('instructors') do |table|
      table.delete('present')
      table['da_present'] = Array.new(table.length, 'TRUE')
      table['en_present'] = Array.new(table.length, 'TRUE')
      table[0]['en_present'] = 'FALSE'
    end
  end

  def test_legacy_matching_columns_still_import
    sync = load_sync
    sync.export(@sheets)
    edit_tab('instructors') do |table|
      %w[present name start image].each do |field|
        values = table[field].to_a
        table.delete(field)
        table["da_#{field}"] = values
        table["en_#{field}"] = values
      end
    end
    assert_empty sync.sync(sources)
  end

  def test_drive_image_url_ignores_dropdown_helper_columns
    sync = load_sync
    sync.export(@sheets)
    url = 'https://lh3.googleusercontent.com/d/public_photo_123?sz=w1600&test=csv'
    edit_tab('instructors', 'lyngby') do |table|
      table['image_choice'] = Array.new(table.length, 'Photo: portrait.jpg [public_photo_123]')
      table['image_preview'] = Array.new(table.length, 'Preview unavailable')
      table[0]['image'] = url
    end
    sync.sync(sources)
    %w[da en].each do |language|
      path = File.join(@root, language, 'lyngby.html')
      data = YAML.safe_load(File.read(path).split(/^---\s*$\r?\n/, 3)[1])
      assert_equal url, data.fetch('instructors').first.fetch('image')
      refute data.fetch('instructors').first.key?('image_choice')
      refute data.fetch('instructors').first.key?('image_preview')
    end
    assert_empty sync.sync(sources)
  end

  def test_legacy_conflicting_shared_values_are_rejected
    assert_rejected('instructors') do |table|
      values = table['name'].to_a
      table.delete('name')
      table['da_name'] = values
      table['en_name'] = values
      table[0]['en_name'] = 'Different instructor'
    end
  end
end