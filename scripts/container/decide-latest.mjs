#!/usr/bin/env node
import { decideLatestPromotion } from './promotion.mjs'

const [candidateRunNumber, state, latestRunNumber] = process.argv.slice(2)
const latest = state === 'found' ? { state, runNumber: Number(latestRunNumber) } : { state }
const decision = decideLatestPromotion({ candidateRunNumber: Number(candidateRunNumber), latest })
console.log(JSON.stringify(decision))
process.exit(decision.promote ? 0 : 10)
