#!/usr/bin/env bash
set -e

# ==============================================================================
# Waypoint Logistics - Keycloak Theme JAR Packaging Script (Bash)
# Builds waypoint-theme.jar for Keycloak /opt/keycloak/providers/
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/waypoint"
OUTPUT_JAR="$SCRIPT_DIR/waypoint-theme.jar"
TEMP_DIR="$SCRIPT_DIR/temp_jar_build"

echo "Building Waypoint Keycloak Theme JAR..."

rm -rf "$TEMP_DIR" "$OUTPUT_JAR"
mkdir -p "$TEMP_DIR/META-INF"
mkdir -p "$TEMP_DIR/theme/waypoint"

cat << 'EOF' > "$TEMP_DIR/META-INF/keycloak-themes.json"
{
  "themes": [
    {
      "name": "waypoint",
      "types": ["login"]
    }
  ]
}
EOF

cp -r "$SOURCE_DIR"/* "$TEMP_DIR/theme/waypoint/"

(cd "$TEMP_DIR" && zip -r "$OUTPUT_JAR" .)
rm -rf "$TEMP_DIR"

echo "Success! Created: $OUTPUT_JAR"
echo "You can now drop waypoint-theme.jar directly into Keycloak's /opt/keycloak/providers/ directory."
