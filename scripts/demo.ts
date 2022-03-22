import { BigNumber, constants } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers, network } from 'hardhat';
import { Manager, MockERC20, MuffinHub, MuffinHubPositions, WETH9 } from '../typechain';
import { bn, getOrDeployContract, logTx, printStruct, wad } from './utils';

/**
 * A demo script to deploy and call the hub contract.
 * Run on hardhat network or rinkeby testnet to try it out.
 */
async function main() {
  // 0. show current user eth balance
  const [user] = await ethers.getSigners();
  console.log('================= main =================');
  console.log('Account Balance: ', await user.getBalance());

  const gasMultiplier = network.name === 'arbitrum' || network.name === 'arbitrumTestnet' ? 1000 : 1;

  // 1 & 2. deploy & get mock tokens contracts
  const weth: WETH9 = await getOrDeployContract('WETH9', {
    hardhat: true,
    localhost: true,
    rinkeby: '0xc778417e063141139fce010982780140aa0cd5ab',
    arbitrumTestnet: '0xb47e6a5f8b33b3f17603c83a0535a9dcd7e32681',
  });
  const wbtc: MockERC20 = await getOrDeployContract('MockERC20', {
    hardhat: true,
    localhost: true,
    rinkeby: '0x868cac73fe792d68e8e91d0fac94acdb0d385af9',
    arbitrumTestnet: '0x530c0e815e743cfffb90adaf37dda3cadee5206a',
  }, 'WBTC', 'WBTC');
  const usdc: MockERC20 = await getOrDeployContract('MockERC20', {
    hardhat: true,
    localhost: true,
    rinkeby: '0x4bac7231ba2392c55e8190de7d216d7ed7b9bf5f',
    arbitrumTestnet: '0x149d5acb49d048474dc2752babbdb3a14f6c6cec',
  }, 'USDC', 'USDC');

  // 3. deploy contracts
  const hubPositions = await getOrDeployContract('MuffinHubPositions', {
    hardhat: true,
    localhost: true,
    rinkeby: true,
    // rinkeby: '0x64490c188a2daec2e8b050f9ac3a4d5699bd0b44',
    arbitrumTestnet: true,
  });
  const hub: MuffinHub = await getOrDeployContract('MuffinHub', {
    hardhat: true,
    localhost: true,
    rinkeby: true,
    // rinkeby: '0xa488583a8b2caecf8e9a576e514e64c8f3b744c8',
    arbitrumTestnet: true,
  }, hubPositions.address);
  const manager: Manager = await getOrDeployContract('Manager', {
    hardhat: true,
    localhost: true,
    rinkeby: true,
    // rinkeby: '0x3ebb5694bb99ada53026cacfeb3cb9f6249f5310',
    arbitrumTestnet: true,
  }, hub.address, weth.address);

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
  await logTx(hub.addTier(token0.address, token1.address, 99925, 1, { gasLimit: 500_000 * gasMultiplier }), 'add tier 15 bps');
  await logTx(hub.addTier(token0.address, token1.address, 99975, 1, { gasLimit: 500_000 * gasMultiplier }), 'add tier  5 bps');

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
    await logTx(weth.approve(manager.address, constants.MaxUint256), 'approve weth to manager');
    await logTx(
      manager.createPool(token0.address, token1.address, 99850, sqrt(price), { gasLimit: 600_000 * gasMultiplier }),
      'create weth-usdc pool',
    );
  }

  // 16. perform a swap
  await logTx(
    manager.exactInSingle(usdc.address, wbtc.address, 0b111111, 100, 0, user.address, false, true, constants.MaxUint256),
    'swap usdc with wbtc',
  );
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
