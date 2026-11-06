#!/usr/bin/env node
'use strict';

// Basic code quality checker (no external dependencies)
const fs = require('fs');
const path = require('path');

const issues = [];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Check 1: Missing 'use strict'
  if (!content.includes('\'use strict\'') && !content.includes('"use strict"')) {
    issues.push({ file: filePath, line: 1, type: 'missing-strict', message: 'Missing \'use strict\'' });
  }

  // Check 2: Trailing whitespace
  lines.forEach((line, idx) => {
    if (line !== line.trimEnd()) {
      issues.push({ file: filePath, line: idx + 1, type: 'trailing-space', message: 'Trailing whitespace' });
    }
  });

  // Check 3: Console.log in production code (warn only)
  const consoleMatches = content.match(/console\.log\(/g);
  if (consoleMatches && consoleMatches.length > 10) {
    issues.push({ file: filePath, line: 0, type: 'excessive-console', message: `Excessive console.log (${consoleMatches.length} occurrences)` });
  }

  // Check 4: Long lines (>120 chars)
  lines.forEach((line, idx) => {
    if (line.length > 120) {
      issues.push({ file: filePath, line: idx + 1, type: 'long-line', message: `Line too long (${line.length} chars)` });
    }
  });

  // Check 5: Missing JSDoc on exported functions
  const exportMatches = content.match(/module\.exports\s*=\s*\{[^}]*\}/g);
  if (exportMatches) {
    // Basic check - if file has exports but no JSDoc comments
    const jsdocCount = (content.match(/\/\*\*/g) || []).length;
    if (jsdocCount === 0 && content.includes('module.exports')) {
      issues.push({ file: filePath, line: 0, type: 'missing-jsdoc', message: 'No JSDoc comments found' });
    }
  }
}

function main() {
  const binDir = path.join(__dirname, '..', 'bin');
  const scriptsDir = path.join(__dirname, '..', 'scripts');

  const files = [];

  // Collect all JS files
  for (const dir of [binDir, scriptsDir]) {
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.js')) {
          files.push(path.join(dir, entry));
        }
      }
    }
  }

  console.log(`Checking ${files.length} files for code quality issues...\n`);

  for (const file of files) {
    checkFile(file);
  }

  // Group issues by type
  const byType = {};
  for (const issue of issues) {
    if (!byType[issue.type]) byType[issue.type] = [];
    byType[issue.type].push(issue);
  }

  // Print summary
  console.log('=== Code Quality Report ===\n');

  if (issues.length === 0) {
    console.log('✅ No issues found! Code quality is excellent.');
    process.exit(0);
  }

  console.log(`Found ${issues.length} issues:\n`);

  for (const [type, typeIssues] of Object.entries(byType)) {
    console.log(`\n📌 ${type} (${typeIssues.length} occurrences):`);
    for (const issue of typeIssues.slice(0, 10)) {
      const relPath = path.relative(__dirname, issue.file);
      console.log(`   ${relPath}:${issue.line} - ${issue.message}`);
    }
    if (typeIssues.length > 10) {
      console.log(`   ... and ${typeIssues.length - 10} more`);
    }
  }

  console.log(`\nTotal: ${issues.length} issues found`);
  console.log('\nRun with --fix to auto-fix some issues (not implemented yet)');

  process.exit(issues.length > 0 ? 1 : 0);
}

main();
