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