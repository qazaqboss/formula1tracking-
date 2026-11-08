#!/usr/bin/env bash
# Cache-busting: stamps ?v=<version> on the site's own JS/CSS URLs so phones and
# CDNs fetch fresh files after every update. Usage: tools/bump-version.sh [version]
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:-$(date +%Y%m%d%H%M)}"
# imports between our modules: from './x.js' or from './x.js?v=old'
perl -pi -e "s#(from '\./(api|data|live|track3d|car3d|fx|bg|teams|game)\.js)(\?v=[0-9a-z]+)?'#\1?v=${V}'#g" js/*.js
perl -pi -e "s#(href=\"css/style\.css)(\?v=[0-9a-z]+)?\"#\1?v=${V}\"#; s#(src=\"js/main\.js)(\?v=[0-9a-z]+)?\"#\1?v=${V}\"#" index.html
perl -pi -e "s#(import\\('\\./(game)\\.js)(\\?v=[0-9a-z]+)?'#\\1?v=${V}'#g" js/main.js
echo "version ${V}"
