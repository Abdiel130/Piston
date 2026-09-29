#!/usr/bin/env bash
# =============================================================================
# up-version.sh — Actualizador centralizado de versiones para Piston
#
# Uso:
#   ./up-version.sh 1.2.2          # Pasando la versión por parámetro
#   ./up-version.sh                # Solicita la versión por CLI de forma interactiva
#
# Archivos actualizados:
#   - app/package.json
#   - app/package-lock.json
#   - server/routes/api.php (/health)
#   - README.md
#   - CHANGELOG.md (preserva [Unreleased] e inserta la nueva versión)
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEW_VERSION="${1:-}"

if [[ -z "$NEW_VERSION" ]]; then
  echo -n "Ingresa la nueva versión (ej. 1.2.2): "
  read -r NEW_VERSION
fi

# Elimina 'v' o 'V' inicial y espacios en blanco
NEW_VERSION="${NEW_VERSION#v}"
NEW_VERSION="${NEW_VERSION#V}"
NEW_VERSION="$(echo -e "${NEW_VERSION}" | tr -d '[:space:]')"

# Validar formato SemVer (ej. 1.2.2 o 1.2.2-rc1)
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]]; then
  echo "❌ Error: La versión '$NEW_VERSION' no cumple con el formato SemVer (ej. 1.2.2 o 1.2.2-rc.1)." >&2
  exit 1
fi

echo "🚀 Actualizando Piston a la versión $NEW_VERSION..."

python3 - "$ROOT_DIR" "$NEW_VERSION" << 'EOF'
import sys
import re
from pathlib import Path
from datetime import date

root_dir = Path(sys.argv[1]).resolve()
new_version = sys.argv[2]
today = date.today().isoformat()

# 1. app/package.json
pkg_file = root_dir / "app" / "package.json"
if pkg_file.is_file():
    content = pkg_file.read_text(encoding="utf-8")
    new_content, count = re.subn(
        r'("name":\s*"piston-app",\s*\n\s*"version":\s*")[^"]*(")',
        rf'\g<1>{new_version}\g<2>',
        content,
        count=1
    )
    if count > 0:
        pkg_file.write_text(new_content, encoding="utf-8")
        print(f"  ✓ {pkg_file.relative_to(root_dir)} -> {new_version}")
    else:
        print(f"  ⚠️  No se encontró 'version' en {pkg_file.relative_to(root_dir)}", file=sys.stderr)

# 2. app/package-lock.json
lock_file = root_dir / "app" / "package-lock.json"
if lock_file.is_file():
    content = lock_file.read_text(encoding="utf-8")
    content, c1 = re.subn(
        r'(^{\s*\n\s*"name":\s*"piston-app",\s*\n\s*"version":\s*")[^"]*(")',
        rf'\g<1>{new_version}\g<2>',
        content,
        count=1
    )
    content, c2 = re.subn(
        r'("":\s*{\s*\n\s*"name":\s*"piston-app",\s*\n\s*"version":\s*")[^"]*(")',
        rf'\g<1>{new_version}\g<2>',
        content,
        count=1
    )
    if c1 > 0 or c2 > 0:
        lock_file.write_text(content, encoding="utf-8")
        print(f"  ✓ {lock_file.relative_to(root_dir)} -> {new_version}")
    else:
        print(f"  ⚠️  No se encontró versión de piston-app en {lock_file.relative_to(root_dir)}", file=sys.stderr)

# 3. server/routes/api.php
api_file = root_dir / "server" / "routes" / "api.php"
if api_file.is_file():
    content = api_file.read_text(encoding="utf-8")
    new_content, count = re.subn(
        r"('project'\s*=>\s*'Piston API',\s*\n\s*'version'\s*=>\s*')[^']*(',)",
        rf"\g<1>{new_version}\g<2>",
        content,
        count=1
    )
    if count == 0:
        new_content, count = re.subn(
            r"('version'\s*=>\s*')[^']*(',)",
            rf"\g<1>{new_version}\g<2>",
            content,
            count=1
        )
    if count > 0:
        api_file.write_text(new_content, encoding="utf-8")
        print(f"  ✓ {api_file.relative_to(root_dir)} -> {new_version}")
    else:
        print(f"  ⚠️  No se encontró 'version' en {api_file.relative_to(root_dir)}", file=sys.stderr)

# 4. README.md
readme_file = root_dir / "README.md"
if readme_file.is_file():
    content = readme_file.read_text(encoding="utf-8")
    new_content, count = re.subn(
        r"(- Versión actual:\s*\*\*)[^*]+(\*\*)",
        rf"\g<1>{new_version}\g<2>",
        content
    )
    if count > 0:
        readme_file.write_text(new_content, encoding="utf-8")
        print(f"  ✓ {readme_file.relative_to(root_dir)} -> {new_version}")
    else:
        print(f"  ⚠️  No se encontró 'Versión actual' en {readme_file.relative_to(root_dir)}", file=sys.stderr)

# 5. CHANGELOG.md
changelog_file = root_dir / "CHANGELOG.md"
if changelog_file.is_file():
    content = changelog_file.read_text(encoding="utf-8")
    
    if re.search(rf"^##\s*\[{re.escape(new_version)}\]", content, re.MULTILINE):
        print(f"  ✓ {changelog_file.relative_to(root_dir)} -> [{new_version}] ya presente (sin cambios)")
    else:
        unreleased_pattern = re.compile(r"(##\s*\[Unreleased\])(.*?)(\n##\s*\[\d+\.\d+\.\d+)", re.DOTALL)
        m = unreleased_pattern.search(content)
        if m:
            unreleased_header = m.group(1)
            between = m.group(2).strip()
            next_header = m.group(3)
            
            if between:
                replacement = f"{unreleased_header}\n\n## [{new_version}] - {today}\n{between}\n{next_header}"
            else:
                replacement = f"{unreleased_header}\n\n## [{new_version}] - {today}\n{next_header}"
                
            new_content = content[:m.start()] + replacement + content[m.end():]
            changelog_file.write_text(new_content, encoding="utf-8")
            print(f"  ✓ {changelog_file.relative_to(root_dir)} -> añadido [{new_version}] y [Unreleased] preparado")
        else:
            first_version_pattern = re.compile(r"(\n##\s*\[\d+\.\d+\.\d+)")
            m_fv = first_version_pattern.search(content)
            if m_fv:
                replacement = f"\n## [Unreleased]\n\n## [{new_version}] - {today}\n{m_fv.group(1)}"
                new_content = content[:m_fv.start()] + replacement + content[m_fv.end():]
                changelog_file.write_text(new_content, encoding="utf-8")
                print(f"  ✓ {changelog_file.relative_to(root_dir)} -> añadido [Unreleased] y [{new_version}]")
            else:
                print(f"  ⚠️  No se encontró estructura de versión en {changelog_file.relative_to(root_dir)}", file=sys.stderr)
EOF

echo ""
echo "✨ Versión $NEW_VERSION aplicada correctamente en todos los archivos."
echo "💡 Recuerda revisar los cambios con 'git diff' antes de hacer commit."
