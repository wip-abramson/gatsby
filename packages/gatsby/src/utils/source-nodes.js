const _ = require(`lodash`)
const report = require(`gatsby-cli/lib/reporter`)

const apiRunner = require(`./api-runner-node`)
const { store } = require(`../redux`)
const { getNode, getNodes } = require(`../db/nodes`)
const { boundActionCreators } = require(`../redux/actions`)
const { deleteNode } = boundActionCreators

/**
 * Finds the name of all plugins which implement Gatsby APIs that
 * may create nodes, but which have not actually created any nodes.
 */
function discoverPluginsWithoutNodes(storeState) {
  // Discover which plugins implement APIs which may create nodes
  const nodeCreationPlugins = _.without(
    _.union(storeState.apiToPlugins.sourceNodes),
    `default-site-plugin`
  )
  // Find out which plugins own already created nodes
  const nodeOwners = _.uniq(
    Array.from(getNodes()).reduce((acc, node) => {
      acc.push(node.internal.owner)
      return acc
    }, [])
  )
  return _.difference(nodeCreationPlugins, nodeOwners)
}

module.exports = async ({ parentSpan } = {}) => {
  await apiRunner(`sourceNodes`, {
    traceId: `initial-sourceNodes`,
    waitForCascadingActions: true,
    parentSpan: parentSpan,
  })

  const state = store.getState()

  // Warn about plugins that should have created nodes but didn't.
  const pluginsWithNoNodes = discoverPluginsWithoutNodes(state)
  pluginsWithNoNodes.map(name =>
    report.warn(
      `The ${name} plugin has generated no Gatsby nodes. Do you need it?`
    )
  )

  // Garbage collect stale data nodes
  const touchedNodes = Object.keys(state.nodesTouched)
  const staleNodes = Array.from(getNodes()).filter(node => {
    // Find the root node.
    let rootNode = node
    let whileCount = 0
    while (
      rootNode.parent &&
      getNode(rootNode.parent) !== undefined &&
      whileCount < 101
    ) {
      rootNode = getNode(rootNode.parent)
      whileCount += 1
      if (whileCount > 100) {
        console.log(
          `It looks like you have a node that's set its parent as itself`,
          rootNode
        )
      }
    }

    return !_.includes(touchedNodes, rootNode.id)
  })

  if (staleNodes.length > 0) {
    staleNodes.forEach(node => deleteNode({ node }))
  }
}
