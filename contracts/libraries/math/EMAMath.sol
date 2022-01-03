// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

library EMAMath {
    uint256 private constant Q64 = 0x10000000000000000;
    uint256 private constant Q128 = 0x100000000000000000000000000000000;

    /**
     *  Definition:
     *  EMA[T] = a * P[T] + (1-a) * EMA[T-1]
     *  -   EMA[T]: EMA price at time T
     *  -   P[T]:   price at time T
     *  -   a:      smoothing factor, 0 < a ≤ 1
     *
     *  For 1-second sampling interval,
     *  -   Using common convention of EMA period:  a = 2/(N+1)
     *  -   Using half-life:                        a = 1 - 2^(-1/H)
     *  -   Combining both formula:             =>  a = 1 - (N+1)/(N-1)
     *
     *  For t-second interval,
     *  -   a = 1 - ((N-1)/(N+1))^t
     *
     *  We want to calculate the decay factor (i.e. 1-a) for a 80-min EMA.
     *  Let N = 4800 sec,
     *      u = (N-1)/(N+1) = 0.999583420121...
     *      t = seconds elapsed since last EMA update
     *  Find d = u^t
     */

    /// @dev Calculate the EMA decay factors for the given time elapsed
    /// @param t The seconds elapsed
    /// @return d80 The decay factor for 80-min EMA (UQ1.64)
    /// @return d40 The decay factor for 40-min EMA (UQ1.64)
    /// @return d20 The decay factor for 20-min EMA (UQ1.64)
    function calcDecayFactors(uint256 t)
        internal
        pure
        returns (
            uint256 d80,
            uint256 d40,
            uint256 d20
        )
    {
        unchecked {
            if (t == 0) return (Q64, Q64, Q64);
            if (t > 0x7FFF) return (0, 0, 0);

            uint256 r = Q128;
            if (t & 0x1 > 0)    r = (r * 0xffe4b2f30aee59b01f9116fb5c684c5c) >> 128;
            if (t & 0x2 > 0)    r = (r * 0xffc968cf6dc9312dd649f36808998649) >> 128;
            if (t & 0x4 > 0)    r = (r * 0xff92dd42fd5a672ebd498b4567c3917a) >> 128;
            if (t & 0x8 > 0)    r = (r * 0xff25e90c945fcfa281e82220ccdab5ab) >> 128;
            if (t & 0x10 > 0)   r = (r * 0xfe4c8be44161aa0c6ab634bb9ab2dc1a) >> 128;
            if (t & 0x20 > 0)   r = (r * 0xfc9bfc7c4db649f230740c7024be524f) >> 128;
            if (t & 0x40 > 0)   r = (r * 0xf94378207089f1ac9c6ec1502beabebd) >> 128;
            if (t & 0x80 > 0)   r = (r * 0xf2b451773445adf3ef3091a1ae17ebbe) >> 128;
            if (t & 0x100 > 0)  r = (r * 0xe61969080861e5738ac8a769e8b004e1) >> 128;
            if (t & 0x200 > 0)  r = (r * 0xced1ab401db9228b428f0adb2e8eb39b) >> 128;
            if (t & 0x400 > 0)  r = (r * 0xa7161b54411533a6baabab4b57d9d07b) >> 128;
            if (t & 0x800 > 0)  r = (r * 0x6d0dd990a24fba7da78ee5c4a2ed3d88) >> 128;
            if (t & 0x1000 > 0) r = (r * 0x2e74cc04fbcee5ca1c36887534798613) >> 128;
            if (t & 0x2000 > 0) r = (r * 0x86e2e9b519a7f7f75add38e871dd6ff) >> 128;
            if (t & 0x4000 > 0) r = (r * 0x471255cb0ff84cf9cf5329fcc4ad76) >> 128;
            // stop here since t < 0x8000

            d80 = r >> 64; // UQ0.64
            d40 = (r * r) >> 192; // UQ0.64
            d20 = (d80 * d80 * d80 * d80) >> 192; // UQ0.64
        }
    }
}
