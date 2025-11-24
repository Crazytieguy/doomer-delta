# Delta

A Bayesian network world-model builder for creating, visualizing, and sharing probabilistic models.

Built with React, Convex, TanStack Router, Clerk, Vite, and Tailwind CSS.

## Features

- **Visual Graph Editor**: Interactive canvas with zoom, pan, and drag-and-drop node positioning
- **Bayesian Networks**: Create binary probability nodes with conditional probability tables (CPTs)
- **Model Management**: Create, edit, share, and clone models
- **Real-time Collaboration**: Models can be made public for viewing and cloning
- **Node Editing**: Rich inspector panel for editing node properties and probabilities
- **Edge Management**: Visual connection creation between parent and child nodes

## Quick Start

```bash
pnpm install
pnpm dev
```

## Project Structure

```
├── convex/
│   ├── models.ts      # Model CRUD operations
│   ├── nodes.ts       # Node management (edges stored in CPT entries)
│   ├── schema.ts      # Database schema
│   └── users.ts       # User authentication
├── src/
│   ├── routes/
│   │   ├── __root.tsx           # Root layout with auth
│   │   ├── index.tsx            # Model list page
│   │   └── models.$modelId.tsx  # Model detail & graph editor
│   ├── components/
│   │   └── GraphEditor.tsx      # Interactive graph canvas
│   └── main.tsx
```

## Usage

1. Sign in with Clerk authentication
2. Create a new model from the home page
3. Double-click the canvas to create nodes
4. Drag from one node to another to create edges
5. Select nodes to edit titles, descriptions, and base probabilities
6. Press Delete or click the X to remove selected nodes or edges

## Future Enhancements

- Scalar (continuous) node types
- Model comparison tools

## License

MIT
