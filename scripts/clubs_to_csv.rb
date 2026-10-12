require_relative 'club_sheets'

if $PROGRAM_NAME == __FILE__
  abort 'Usage: ruby scripts/clubs_to_csv.rb OUTPUT_DIRECTORY' unless ARGV.length == 1
  begin
    ClubSheets.new(File.expand_path('..', __dir__)).export(ARGV[0])
    puts "Exported seven tabs per club and sources.json to #{ARGV[0]}"
  rescue StandardError => error
    abort "ERROR: #{error.message}"
  end
end