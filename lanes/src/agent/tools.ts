/**
 * An AI agent is a participant like any other: it connects as an agent, holds
 * whatever roles the graph grants it, and its writes land in the same log with
 * its name on them. So there is no separate "AI API" to keep in sync. The tool
 * list a model is shown is generated from the schema and filtered by the
 * agent's actual role, and every tool call goes through the ordinary client.
 */

import type { Client } from '../client/client.ts'
import { LaneError, type AnyHandle, type FieldSpec, type Fields, type Model } from '../core/schema.ts'

/** A tool definition in the shape LLM tool-use APIs expect. */
export interface Tool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, object>
    required: string[]
    additionalProperties: false
  }
}

function jsonType(spec: FieldSpec): object {
  const described = spec.doc ? { description: spec.doc } : {}
  switch (spec.kind) {
    case 'string':
      return { type: 'string', ...described }
    case 'number':
      return { type: 'number', ...described }
    case 'boolean':
      return { type: 'boolean', ...described }
    case 'enum':
      return { type: 'string', enum: [...spec.values!], ...described }
    case 'ref':
      return { type: ['string', 'null'], description: spec.doc ?? `Id of a ${spec.ref}` }
    case 'json':
      return described
  }
}

function tool(name: string, description: string, properties: Record<string, object>, required: string[]): Tool {
  return { name, description, input_schema: { type: 'object', properties, required, additionalProperties: false } }
}

/** Models that can appear under `root`, the root's own model first. */
function modelsUnder(client: Client, root: Model): Model[] {
  const out = [root]
  for (let i = 0; i < out.length; i++) {
    for (const model of client.schema.models.values()) {
      if (model.parent === out[i].name && !out.includes(model)) out.push(model)
    }
  }
  return out
}

/** The tools this agent may use on `root` right now. A viewer gets none that write. */
export function toolsFor(client: Client, root: AnyHandle): Tool[] {
  const rank = client.schema.rank(root.$role)
  const tools: Tool[] = []
  for (const model of modelsUnder(client, root.$model)) {
    const name = model.name.toLowerCase()
    const writable: Record<string, object> = {}
    for (const [field, spec] of Object.entries(model.fields)) {
      if (spec.scope === 'shared' && rank >= model.fieldWriteRank(field)) writable[field] = jsonType(spec)
    }
    if (model !== root.$model && rank >= model.createRank) {
      tools.push(
        tool(
          `create_${name}`,
          `Create a ${model.name}. Give "after" to place it right after an existing sibling; otherwise it goes last.`,
          { parent: { type: 'string', description: `Id of the parent ${model.parent}` }, after: { type: 'string' }, ...writable },
          ['parent'],
        ),
      )
    }
    if (Object.keys(writable).length > 0) {
      tools.push(tool(`update_${name}`, `Change fields of a ${model.name}.`, { id: { type: 'string' }, ...writable }, ['id']))
    }
    if (model !== root.$model && rank >= model.deleteRank) {
      tools.push(tool(`delete_${name}`, `Delete a ${model.name} and everything under it.`, { id: { type: 'string' } }, ['id']))
    }
  }
  for (const action of client.actions(root)) {
    const properties: Record<string, object> = {}
    for (const [key, spec] of Object.entries(action.input)) properties[key] = jsonType(spec)
    tools.push(tool(`run_${action.name.replace(/\W/g, '_')}`, action.doc ?? action.label, properties, []))
  }
  return tools
}

/**
 * Carry out one tool call through the ordinary client. A call the agent's role
 * does not allow fails exactly as it would for a person.
 */
export function applyTool(client: Client, root: AnyHandle, name: string, input: Fields): unknown {
  const [verb, ...rest] = name.split('_')
  const subject = rest.join('_')
  if (verb === 'run') {
    const action = [...client.schema.actions.values()].find(a => a.name.replace(/\W/g, '_') === subject)
    if (!action) throw new LaneError('invalid', `Unknown tool ${name}`)
    return client.run(action, root as any, input)
  }
  const model = modelsUnder(client, root.$model).find(m => m.name.toLowerCase() === subject)
  if (!model) throw new LaneError('invalid', `Unknown tool ${name}`)

  if (verb === 'create') {
    const { parent, after, ...fields } = input
    const parentHandle = client.find(parent as string)
    if (!parentHandle) throw new LaneError('not_found', `No object ${String(parent)}`)
    const created = client.create(model, { ...fields, parent: parentHandle, after: client.find(after as string) })
    return { id: created.id }
  }
  const target = client.get(model, input.id as string)
  if (!target) throw new LaneError('not_found', `No ${model.name} ${String(input.id)}`)
  if (verb === 'update') {
    const { id: _id, ...fields } = input
    client.tx(() => {
      for (const [field, value] of Object.entries(fields)) (target as any)[field] = value
    })
    return { id: target.id }
  }
  if (verb === 'delete') {
    client.remove(target)
    return { id: target.id }
  }
  throw new LaneError('invalid', `Unknown tool ${name}`)
}

/** The subtree under `root` as indented text with ids, for a model's context window. */
export function outline(client: Client, root: AnyHandle): string {
  const lines: string[] = []
  const walk = (handle: AnyHandle, depth: number) => {
    const model = handle.$model
    const fields = Object.entries(model.fields)
      .filter(([, spec]) => spec.scope === 'shared')
      .map(([field]) => `${field}=${JSON.stringify((handle as any)[field])}`)
    lines.push(`${'  '.repeat(depth)}[${handle.id}] ${model.name} ${fields.join(' ')}`)
    for (const child of client.schema.models.values()) {
      if (child.parent === model.name) for (const kid of client.children(handle, child)) walk(kid, depth + 1)
    }
  }
  walk(root, 0)
  return lines.join('\n')
}
