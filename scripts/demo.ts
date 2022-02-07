import { BigNumber, constants } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers, network } from 'hardhat';
import { Manager, MockERC20, MuffinHub, MuffinHubPositions, WETH9 } from '../typechain';
import { bn, deploy, logTx, printStruct, wad } from './utils';

/**
 * A demo script to deploy and call the hub contract.
 * Run on hardhat network or rinkeby testnet to try it out.
 */
async function main() {
  // 0. show current user eth balance
  const [user] = await ethers.getSigners();
  console.log('================= main =================');
  console.log('Account Balance: ', await user.getBalance());

  // 1. deploy weth if we're on local network
  let WETH_ADDRESS;
  if (network.name === 'hardhat') WETH_ADDRESS = (await deploy('WETH9')).address;
  else if (network.name === 'rinkeby') WETH_ADDRESS = '0xc778417e063141139fce010982780140aa0cd5ab';
  else throw new Error('unknown network');

  // 2. deploy mock tokens
  const weth = (await ethers.getContractAt('WETH9', WETH_ADDRESS)) as WETH9;
  const wbtc = (await deploy('MockERC20', 'WBTC', 'WBTC')) as MockERC20;
  const usdc = (await deploy('MockERC20', 'USDC', 'USDC')) as MockERC20;

  // 3. deploy contracts
  const hub = (await deploy('MuffinHub', (await deploy('MuffinHubPositions')).address)) as MuffinHub;
  const manager = (await deploy('Manager', hub.address, weth.address)) as Manager;

  // 4. mint and approve tokens
  await logTx(usdc.mint(wad(10000)), 'mint usdc');
  await logTx(wbtc.mint(wad(10000)), 'mint wbtc');
  await logTx(usdc.approve(manager.address, ethers.constants.MaxUint256), 'approve usdc to manager');
  await logTx(wbtc.approve(manager.address, ethers.constants.MaxUint256), 'approve wbtc to manager');

  // 5. deposit tokens for creating pool
  await logTx(manager.deposit(user.address, wbtc.address, wad(1)), 'deposit wbtc');
  await logTx(manager.deposit(user.address, usdc.address, wad(1)), 'deposit usdc');

  // 6. create pool
  const btcUsdPrice = bn(1).shl(144); // assume btc:usd = 1:1
  const [token0, token1, price] =
    wbtc.address.toLowerCase() < usdc.address.toLowerCase()
      ? [wbtc, usdc, btcUsdPrice]
      : [usdc, wbtc, bn(1).shl(288).div(btcUsdPrice)];
  await logTx(manager.createPool(token0.address, token1.address, 99850, sqrt(price)), 'create pool + add tier 30 bps');

  // 7. add some more tiers
  await logTx(manager.depositToExternal(user.address, 1, token0.address, wad(1)), 'deposit token0 externally');
  await logTx(manager.depositToExternal(user.address, 1, token1.address, wad(1)), 'deposit token1 externally');
  await logTx(hub.addTier(token0.address, token1.address, 99925, 1, { gasLimit: 500000 }), 'add tier 15 bps');
  await logTx(hub.addTier(token0.address, token1.address, 99975, 1, { gasLimit: 500000 }), 'add tier  5 bps');

  // 8. set pool's tick spacing to 1, protocol fee to 15%
  const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));
  const _hub = (await ethers.getContractAt('MuffinHubPositions', hub.address)) as MuffinHubPositions;
  await _hub.setPoolParameters(poolId, 1, Math.floor(0.15 * 255));

  // 9. set tier's limit order tick spacing to 2 ticks
  await _hub.setTierParameters(poolId, 0, 99850, 200);

  // 10. add liquidity
  let promise = manager.mint({
    token0: token0.address,
    token1: token1.address,
    tierId: 0,
    tickLower: -100,
    tickUpper: 100,
    amount0Desired: wad(1),
    amount1Desired: wad(1),
    amount0Min: 0,
    amount1Min: 0,
    recipient: user.address,
    useAccount: false,
  });
  await logTx(promise, 'add liquidity');

  // 11. fetch position info
  const tokenId = 1;
  const { position: positionDetail, ...positionInfo } = await manager.getPosition(tokenId);
  printStruct('position', positionInfo);
  printStruct('position.position', positionDetail);
  console.log('');

  // 12. swap (exact in)
  await logTx(
    manager.exactInSingle(token0.address, token1.address, 0b111111, 1e8, 0, user.address, false, false, constants.MaxUint256),
    'swap',
  );

  // 13. remove liquidity
  promise = manager.removeLiquidity({
    tokenId,
    liquidityD8: 1000,
    amount0Min: 0,
    amount1Min: 0,
    withdrawTo: user.address,
    collectAllFees: true,
    settled: false,
  });
  await logTx(promise, 'remove liquidity');

  // 14. set position to limit order
  await logTx(manager.setLimitOrderType(tokenId, 1), 'set limit order'); // 1 means zero for one

  // 15. create a weth-usdc pool (for subgraph)
  {
    const ethUsdPrice = bn(2500).shl(144);
    const [token0, token1, price] =
      weth.address.toLowerCase() < usdc.address.toLowerCase()
        ? [weth, usdc, ethUsdPrice]
        : [usdc, weth, bn(1).shl(288).div(ethUsdPrice)];

    await logTx(weth.deposit({ value: 1e8 }), 'mint weth');
    await logTx(weth.approve(hub.address, constants.MaxUint256), 'approve weth to manager');
    await logTx(
      manager.createPool(token0.address, token1.address, 99850, sqrt(price), { gasLimit: 600_000 }),
      'create weth-usdc pool',
    );
  }

  // 16. perform a swap
  await manager.exactInSingle(usdc.address, wbtc.address, 0x3f, 100, 0, user.address, false, true, constants.MaxUint256);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

const sqrt = (y: BigNumber) => {
  let z = y;
  let x: BigNumber;
  if (y.gt(3)) {
    z = y;
    x = y.div(2).add(1);
    while (x.lt(z)) {
      z = x;
      x = y.div(x).add(x).div(2);
    }
  } else if (!y.eq(0)) {
    z = BigNumber.from('1');
  }
  return z;
};
