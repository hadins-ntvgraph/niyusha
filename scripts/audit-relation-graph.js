'use strict';

const fs = require('fs');
const path = require('path');
const {
  atomizeHistory,
  buildRelationGraph,
  canonicalEntity,
} = require('../bin/context-engine');

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/audit-relation-graph.js <archive.jsonl>');
    process.exit(2);
  }

  const records = readJsonl(path.resolve(file));
  const atoms = [];
  let messages = 0;
  for (const record of records) {
    const history = Array.isArray(record.messages) ? record.messages : [];
    messages += history.length;
    atoms.push(...atomizeHistory(history, {
      summary: record.summary,
      source: 'archive',
      state: record.state || null,
    }));
  }

  const graph = buildRelationGraph(atoms);
  const entities = new Map();
  for (const atom of atoms) {
    const key = canonicalEntity(atom.entity);
    if (!key) continue;
    entities.set(key, (entities.get(key) || 0) + 1);
  }

  const explicit = graph.edges.filter((edge) => edge.kind === 'explicit');
  const cooccurrence = graph.edges.filter((edge) => edge.kind === 'cooccurrence');
  const resolvable = explicit.filter((edge) => edge.to);
  const connected = new Set();
  const relationTypes = {};
  for (const edge of explicit) {
    relationTypes[edge.type] = (relationTypes[edge.type] || 0) + 1;
  }
  for (const edge of graph.edges) {
    if (!edge.to) continue;
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const repeated = [...entities.values()].filter((count) => count >= 2);
  const atomsSharing = repeated.reduce((sum, count) => sum + count, 0);
  const potentialPairs = repeated.reduce((sum, count) => sum + (count * (count - 1)) / 2, 0);
  const degreeValues = [...graph.degree.values()];

  const report = {
    file: path.basename(path.resolve(file)),
    records: records.length,
    messages,
    atoms: atoms.length,
    atomsWithEntity: atoms.filter((atom) => canonicalEntity(atom.entity)).length,
    atomsWithRelations: atoms.filter((atom) => (atom.relations || []).length > 0).length,
    distinctEntities: entities.size,
    entitiesInTwoPlusAtoms: repeated.length,
    atomsSharingEntity: atomsSharing,
    potentialSharedEntityPairs: potentialPairs,
    explicitEdges: explicit.length,
    resolvableExplicitEdges: resolvable.length,
    unresolvedExplicitEdges: explicit.length - resolvable.length,
    cooccurrenceEdges: cooccurrence.length,
    totalEdges: graph.edges.length,
    connectedAtoms: connected.size,
    connectedRatio: round(atoms.length ? connected.size / atoms.length : 0),
    nonZeroCentralityAtoms: atoms.filter((atom) => Number(atom.centrality) > 0).length,
    maxDegree: degreeValues.length ? Math.max(...degreeValues) : 0,
    relationTypes,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
