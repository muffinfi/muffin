# Muffin

**Muffin** is an concentrated liquidity AMM protocol that supports multiple fee tiers per pool, and limit range orders.

## Entry points

- [`MuffinHub.sol`](./contracts/MuffinHub.sol): Stores all states of liquidity pool and positions and handle all swaps and liquidity actions.

- [`periphery/Manager.sol`](./contracts/periphery/Manager.sol): Act as the interface for users to interact with MuffinHub. Manage user's positions and internal accounts. It's also an ERC-721 contract for position NFTs.

- [`libraries/Pools.sol`](./contracts/libraries/Pools.sol) The library that contains all functionalities of a liquidity pool, including swap and mint/burn liquidity. Used by MuffinHub.sol to perform any pool-level actions.
