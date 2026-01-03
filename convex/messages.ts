import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const getForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (identity === null) {
      return []
    }
    
    const author = identity.email ?? identity.tokenIdentifier
    
    return await ctx.db
      .query('messages')
      .filter((q) => q.eq(q.field('author'), author))
      .collect()
  },
})

export const createForCurrentUser = mutation({
  args: {
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    
    if (identity === null) {
      throw new Error('Not authenticated')
    }
    
    // Use tokenIdentifier (always present) or email with fallback
    const author = identity.email ?? identity.tokenIdentifier
    
    const messageId = await ctx.db.insert('messages', {
      text: args.text,
      author: author,
      timestamp: Date.now(),
    })
    
    return messageId
  },
})