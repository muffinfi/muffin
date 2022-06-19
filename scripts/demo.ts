import { BigNumber, constants } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers, network } from 'hardhat';
import { Manager, MockERC20, MuffinHub, IMuffinHubCombined, MuffinHubPositions, WETH9 } from '../typechain';
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
  const wbtc = (await deploy('MockERC20', 'Wrapped BTC', 'WBTC')) as MockERC20;
  const usdc = (await deploy('MockERC20', 'USD Coin', 'USDC')) as MockERC20;
  await logTx(wbtc.setDecimals(8), 'wbtc.setDecimals');
  await logTx(usdc.setDecimals(6), 'usdc.setDecimals');

  // 3. deploy contracts
  const _hub = (await deploy('MuffinHub', (await deploy('MuffinHubPositions')).address)) as MuffinHub;
  const hub = (await ethers.getContractAt('IMuffinHubCombined', _hub.address)) as IMuffinHubCombined;
  const manager = (await deploy('Manager', hub.address, weth.address)) as Manager;

  // 4. mint and approve tokens
  await logTx(wbtc.mint(10000e8), 'mint wbtc');
  await logTx(usdc.mint(10000e6), 'mint usdc');
  await logTx(wbtc.approve(manager.address, ethers.constants.MaxUint256), 'approve wbtc to manager');
  await logTx(usdc.approve(manager.address, ethers.constants.MaxUint256), 'approve usdc to manager');

  // 5. deposit tokens for creating pool
  await logTx(manager.deposit(user.address, wbtc.address, 1e8), 'deposit wbtc');
  await logTx(manager.deposit(user.address, usdc.address, 1e6), 'deposit usdc');

  // 6. create pool
  const btcUsdPrice = bn(1e6).shl(144).div(1e8); // assume btc:usd = 1:1
  const [token0, token1, price] =
    wbtc.address.toLowerCase() < usdc.address.toLowerCase()
      ? [wbtc, usdc, btcUsdPrice]
      : [usdc, wbtc, bn(1).shl(288).div(btcUsdPrice)];
  const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));
  await logTx(hub.setPoolAllowedSqrtGammas(poolId, [99975, 99940, 99875, 99800]), 'set pool sqrt gammas whitelist');
  await logTx(
    manager.createPool(token0.address, token1.address, 99975, sqrt(price), false, { gasLimit: 600_000 }),
    'create pool + add tier 5 bps',
  );

  // 7. add some more tiers
  await logTx(manager.addTier(token0.address, token1.address, 99940, false, { gasLimit: 500000 }), 'add tier 12 bps');
  await logTx(manager.addTier(token0.address, token1.address, 99875, false, { gasLimit: 500000 }), 'add tier 25 bps');
  await logTx(manager.addTier(token0.address, token1.address, 99800, false, { gasLimit: 500000 }), 'add tier 40 bps');

  // 8. set pool's tick spacing to 1, protocol fee to 15%
  await logTx(hub.setPoolParameters(poolId, 25, Math.floor(0.15 * 255)), 'set pool parameters');

  // 9. set tier's limit order tick spacing to 1 tickspacing
  await logTx(hub.setTierParameters(poolId, 0, 99975, 1), 'set tier parameters');

  // 10. add liquidity
  await logTx(
    manager.mint({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: 0,
      tickUpper: 25,
      amount0Desired: 1e8,
      amount1Desired: 1e8,
      amount0Min: 0,
      amount1Min: 0,
      recipient: user.address,
      useAccount: false,
    }),
    'add liquidity',
  );

  // 11. fetch position info
  const tokenId = 1;
  const { position: positionDetail, ...positionInfo } = await manager.getPosition(tokenId);
  printStruct('position', positionInfo);
  printStruct('position.position', positionDetail);
  console.log('');

  // 12. swap (exact in)
  await logTx(
    manager.exactInSingle(token0.address, token1.address, 0b111111, 100, 0, user.address, false, false, constants.MaxUint256),
    'swap',
  );

  // 13. remove liquidity
  await logTx(
    manager.removeLiquidity({
      tokenId,
      liquidityD8: 1000,
      amount0Min: 0,
      amount1Min: 0,
      withdrawTo: user.address,
      collectAllFees: true,
      settled: false,
    }),
    'remove liquidity',
  );

  // 14. set position to limit order
  await logTx(manager.setLimitOrderType(tokenId, 1), 'set limit order'); // 1 means zero for one

  // 15. create a weth-usdc pool (for subgraph)
  {
    const ethUsdPrice = bn(2500e6).shl(144).div(bn(10).pow(18));
    const [token0, token1, price] =
      weth.address.toLowerCase() < usdc.address.toLowerCase()
        ? [weth, usdc, ethUsdPrice]
        : [usdc, weth, bn(1).shl(288).div(ethUsdPrice)];
    const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));

    await logTx(weth.deposit({ value: 1e12 }), 'mint weth');
    await logTx(weth.approve(manager.address, constants.MaxUint256), 'approve weth to manager');
    await logTx(hub.setPoolAllowedSqrtGammas(poolId, [99975, 99940, 99875, 99800]), 'set pool sqrt gammas whitelist');
    await logTx(
      manager.createPool(token0.address, token1.address, 99975, sqrt(price), false, { gasLimit: 600_000 }),
      'create weth-usdc pool',
    );
  }
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
