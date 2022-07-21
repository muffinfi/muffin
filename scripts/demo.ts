import { BigNumber, constants } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers, network } from 'hardhat';
import { IMuffinHubCombined, Manager, MockERC20, WETH9 } from '../typechain';
import { bn, getOrDeployContract, logTx, permit, printStruct } from './utils';

/**
 * A demo script to deploy and call the hub contract.
 * Run on hardhat network or rinkeby testnet to try it out.
 */

/***/

const wethAddressMap = {
  hardhat: true,
  rinkeby: '0xc778417e063141139fce010982780140aa0cd5ab',
  arbitrumTestnet: '0xb47e6a5f8b33b3f17603c83a0535a9dcd7e32681',
};

const wbtcAddressMap = {
  hardhat: true,
  rinkeby: true,
  arbitrumTestnet: '0x689E3BC156Cdf5d05689A128B53A3be0f7ca3406',
};

const usdcAddressMap = {
  hardhat: true,
  rinkeby: true,
  arbitrumTestnet: '0xE39515Fa7414d39803c21A58626aC29DBc328A5f',
};

const hubPositionsAddressMap = {
  hardhat: true,
  rinkeby: true,
  arbitrumTestnet: '0x74E8e8A800618be03cf04F2E80A1dB4F2eAd7caE',
};

const hubAddressMap = {
  hardhat: true,
  rinkeby: true,
  arbitrumTestnet: '0x1bB9dCBD601718EB4f562000BA77f712587D9B5B',
};

const managerAddressMap = {
  hardhat: true,
  rinkeby: true,
  arbitrumTestnet: '0x23934f8D38Fdb9C36Dd5A026C0e113Da1e1e775a',
};

async function main() {
  const gasMultiplier = network.name === 'arbitrum' || network.name === 'arbitrumTestnet' ? 1000 : 1;

  // 0. show current user eth balance
  const [user] = await ethers.getSigners();
  console.log('================= main =================');
  console.log('Account Balance: ', await user.getBalance());

  // 1. deploy weth if we're on local network
  const weth = await getOrDeployContract<WETH9>('WETH9', wethAddressMap);

  // 2. deploy mock tokens
  const wbtc = await getOrDeployContract<MockERC20>('MockERC20', wbtcAddressMap, ['Wrapped BTC', 'WBTC']);
  const usdc = await getOrDeployContract<MockERC20>('MockERC20', usdcAddressMap, ['USD Coin', 'USDC']);
  if ((await wbtc.decimals()) !== 8) await logTx(wbtc.setDecimals(8), 'wbtc.setDecimals');
  if ((await usdc.decimals()) !== 6) await logTx(usdc.setDecimals(6), 'usdc.setDecimals');

  // 3. deploy contracts
  const _hubPositions = await getOrDeployContract('MuffinHubPositions', hubPositionsAddressMap);
  const _hub = await getOrDeployContract('MuffinHub', hubAddressMap, [_hubPositions.address]);
  const hub = (await ethers.getContractAt('IMuffinHubCombined', _hub.address)) as IMuffinHubCombined;
  const manager = await getOrDeployContract<Manager>('Manager', managerAddressMap, [hub.address, weth.address]);

  // 4. mint tokens
  await logTx(wbtc.mint(10000e8), 'mint wbtc');
  await logTx(usdc.mint(10000e6), 'mint usdc');

  // 5. calculate token price
  const btcUsdPrice = bn(1e6).shl(144).div(1e8); // assume btc:usd = 1:1
  const [token0, token1, price] =
    wbtc.address.toLowerCase() < usdc.address.toLowerCase()
      ? [wbtc, usdc, btcUsdPrice]
      : [usdc, wbtc, bn(1).shl(288).div(btcUsdPrice)];

  // 6. set pool fee tier whitelist
  const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));
  await logTx(hub.setPoolAllowedSqrtGammas(poolId, [99975, 99940, 99875, 99800]), 'set pool sqrt gammas whitelist');

  // 7. create pool and add tiers
  const sig0 = await permit(user, manager.address, token0);
  const sig1 = await permit(user, manager.address, token1);
  await logTx(
    manager.multicall(
      [
        manager.interface.encodeFunctionData('selfPermit', [token0.address, constants.MaxUint256, constants.MaxUint256, sig0.v, sig0.r, sig0.s]), // prettier-ignore
        manager.interface.encodeFunctionData('selfPermit', [token1.address, constants.MaxUint256, constants.MaxUint256, sig1.v, sig1.r, sig1.s]), // prettier-ignore
        manager.interface.encodeFunctionData('createPool', [token0.address, token1.address, 99975, sqrt(price), false]),
        manager.interface.encodeFunctionData('addTier', [token0.address, token1.address, 99940, false, 255]),
        manager.interface.encodeFunctionData('addTier', [token0.address, token1.address, 99875, false, 255]),
        manager.interface.encodeFunctionData('addTier', [token0.address, token1.address, 99800, false, 255]),
      ],
      { gasLimit: 3_000_000 * gasMultiplier },
    ),
    'create pool + add tier 5, 12, 25, 40 bps',
  );

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
      manager.createPool(token0.address, token1.address, 99975, sqrt(price), false, { gasLimit: 600_000 * gasMultiplier }),
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
