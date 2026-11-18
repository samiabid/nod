---
title: Build an app for Nod
description: Create, test, and submit an app connection for Nod.
sidebar:
  label: Overview
  order: 2
---

Add an app folder, run the required checks, and submit a pull request.

This guide is for community contributors and partners. An app is a service listed in **Apps**. A connection is one account or instance of that service. Nod stores account credentials separately from the app files.

App folders use [Agent Plugins 1.0.0](https://agent-plugins.org/specification). The `io.n8n.nod` extension points to a settings file with Nod's display and setup fields. Versioned schemas, TypeScript types, runtime validation, and required checks share one source. Version one supports MCP servers, HTTP APIs, and command-line tools. Each method uses the same Apps entry, private setup, account controls, and public page. App folders contain metadata and optional guides. CLI apps use Nod’s existing sealed installer and runner.

## Before you start

- Set up a [source install](/get-started/install-from-source/).
- Choose the provider's supported MCP server, HTTP API, or CLI. Check its authentication, permissions, and limits.
- Find a documented read operation for the required synthetic fixture and connection check.
- Check the [app catalog](/connect/community-apps/) for an existing app entry.

You do not need to write TypeScript for a supported connection. APIs and CLIs connect directly. Users select the app and complete its private setup.

App-only contributions that use this profile can start with a folder and a PR. If the app needs a Nod runtime change, open an issue or discussion before you implement that change.

## Build and submit

| Step                                | Guide                                                 |
| ----------------------------------- | ----------------------------------------------------- |
| Choose the access method and scope  | [Plan the app](/contribute/apps/plan/)                |
| Generate and complete an app folder | [Build your first app](/contribute/apps/build/)       |
| See API and CLI examples            | [API and CLI examples](/contribute/apps/api-and-cli/) |
| Check every field                   | [Format reference](/contribute/apps/format/)          |
| Run the required offline checks     | [Test the app](/contribute/apps/test/)                |
| Meet the review requirements        | [Get an app approved](/contribute/apps/approval/)     |
| Use an AI coding agent              | [Build with AI](/contribute/apps/build-with-ai/)      |

## What a contribution creates

The folder supplies the app card and connection setup. The same metadata supplies a public docs page and a social preview image. The docs build adds the app to the catalog automatically.

Nod's n8n, Linear, and Notion folders are working source examples. They use the same loader and checks as community contributions.

## Related resources

- [Contribute to Nod](/contribute/)
- [Browse custom apps](/connect/community-apps/)
- [MCP servers, APIs and CLIs](/connect/mcp-api-cli/)
