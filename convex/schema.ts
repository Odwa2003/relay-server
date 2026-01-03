import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  messages: defineTable({
    text: v.string(),
    author: v.string(),
    timestamp: v.number(),
  }).index('by_author', ['author']),
})