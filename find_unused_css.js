const fs = require('fs');
const path = require('path');

function getFiles(dir, ext) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFiles(fullPath, ext));
        } else if (fullPath.endsWith(ext)) {
            results.push(fullPath);
        }
    }
    return results;
}

const cssDir = path.join(__dirname, 'www', 'css');
const wwwDir = path.join(__dirname, 'www');

const cssFiles = getFiles(cssDir, '.css');
const htmlFiles = getFiles(wwwDir, '.html');
const jsFiles = getFiles(wwwDir, '.js');

const sourceFiles = [...htmlFiles, ...jsFiles];

let classIdMap = new Map(); // name -> Set of css files it occurs in

const classRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
const idRegex = /#([a-zA-Z_][a-zA-Z0-9_-]*)/g;

// Exclude common pseudo-classes and classes that aren't actually custom classes
const excludeList = new Set([
    'active', 'hover', 'focus', 'visited', 'link', 'before', 'after', 
    'first-child', 'last-child', 'nth-child', 'nth-of-type', 'not',
    'webkit-scrollbar', 'webkit-scrollbar-thumb', 'webkit-scrollbar-track',
    'root', 'empty', 'checked', 'disabled'
]);

for (const cssFile of cssFiles) {
    const content = fs.readFileSync(cssFile, 'utf8');
    
    // Find classes
    let match;
    while ((match = classRegex.exec(content)) !== null) {
        const name = match[1];
        if (!excludeList.has(name)) {
            if (!classIdMap.has(name)) {
                classIdMap.set(name, new Set());
            }
            classIdMap.get(name).add(cssFile);
        }
    }
    
    // Find IDs
    while ((match = idRegex.exec(content)) !== null) {
        const name = match[1];
        if (!excludeList.has(name)) {
            if (!classIdMap.has(name)) {
                classIdMap.set(name, new Set());
            }
            classIdMap.get(name).add(cssFile);
        }
    }
}

// Read all source contents into memory
const sourceContents = sourceFiles.map(f => fs.readFileSync(f, 'utf8'));

let unused = [];

for (const [name, files] of classIdMap.entries()) {
    let found = false;
    for (const content of sourceContents) {
        // Just search for the string. If it's not even a substring, it's definitely unused (unless dynamically constructed).
        // It's safer to use a regex or just indexOf since we want to catch occurrences in strings too.
        if (content.indexOf(name) !== -1) {
            found = true;
            break;
        }
    }
    if (!found) {
        unused.push({ name, files: Array.from(files) });
    }
}

fs.writeFileSync('unused_css.json', JSON.stringify(unused, null, 2));
console.log(`Found ${unused.length} potentially unused CSS selectors.`);
