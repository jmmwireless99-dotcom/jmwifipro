# 8x 2.5G PoE+ at 4x 10G SFP+ schematic

Reference schematic para sa EasyEDA Standard. Hindi ito fabrication-ready PCB.

## Buksan sa EasyEDA

1. EasyEDA Standard (hindi Pro).
2. File, Open, EasyEDA Source.
3. Piliin ang `easyeda/POE_SW_8x2G5_4xSFP.json`.
4. Sampung sheet ang lalabas. Parehong net name sa magkakaibang sheet ay iisang net.

Walang naka-embed na footprint. Bago mag-PCB:

1. Design, Update Components from Library.
2. I-check ang footprint column lang. Huwag i-check ang Symbol column, kung hindi ay papalitan ang simbolo.
3. Ang SoC, magnetics, ESD, TPS51200, at PCA9546A ay functional symbols. Ilagay ang totoong footprint pagkatapos i-verify ang datasheet.

I-regenerate ang JSON gamit ang:

```bash
python3 tools/generate_easyeda.py
```

## Ano ang nasa loob

| Sheet | Laman |
| --- | --- |
| 01 | 54 V input, fuse, IRF9540N reverse polarity, TVS, isang chassis bond |
| 02 | TPS54560B para sa 5 V, 3.3 V, at 12 V |
| 03 | TPS54302, isa kada RTL8221B (0.95 V), DDR 1.5 V, SoC core placeholder, TPS51200 |
| 04 | TPS23881, address 0x20, Kelvin net-tie KS_A hanggang KS_D |
| 05, 06 | 8 port, 2-pair Alt-A, IRF540N, 0.200 ohm, 1.5 A fuse |
| 07, 08 | RTL8221B, discrete 2.5G PoE magnetics, RJ45, Bob Smith, ESD |
| 09 | 4x SFP+ at PCA9546A (0x70) |
| 10 | Functional RTL9313, SPI flash, DDR3 power, UART, fan |

PoE budget: 8 x 30 W = 240 W. Supply: 54 V, hindi bababa sa 6 A (mga 320 W). Logic ground = 54 V return.

## Bago mag-layout o magpagawa ng board

- Ang RTL9313 ball map ay hindi pampubliko. Palitan ang `RTL9313_FUNC` ng vendor BGA symbol. Huwag i-route ang PCB mula sa pin numbers ng symbol na ito.
- Kumpirmahin ang SoC core voltage sa Realtek hardware design guide. Ang `V095_SOC` divider (6.04k / 10.2k) ay 0.95 V placeholder lang.
- I-retune ang COMP ng 3.3 V at 12 V bucks sa WEBENCH. Ang 5 V network ay galing sa TPS54560B Fig. 32, maliban sa 100 V catch diode.
- Magnetics pin 1 hanggang 25 ay logical. I-remap sa napiling Pulse, Wurth, o Link-PP na 2.5G PoE transformer.
- ESD (`TPD4E02B04`) at `TPS51200` pin numbers ay functional. PCA9546A TSSOP order: i-check ang NXP Fig. 1.
- IRF9540N ay mainit sa 6 A. Palitan ng 100 V P-MOS na mababa sa 20 mohm bago i-build.
- Ang SMBJ58A clamp ay pwedeng lumampas sa 70 V absolute max ng TPS23881 sa surge.
- 54 V ay pwedeng manakit at magsimula ng sunog. Sundin ang TI TPS23881 EVM layout para sa PoE.

## Parts na datasheet-accurate

- RTL8221B-VB-CG, QFN-48, LCSC C5155988. MDI, SerDes, RSET 2.49k, 25 MHz na may 27 pF, PHY address sa LED pins.
- TPS23881RTQR. RSENSE = 0.200 ohm 1% 1 W. SDAI at SDAO ay magkadugtong. A4:A1 pulldown, address 0x20.
- TPS54560BDDA at TPS54302DDCR pinouts.
- W25Q256JVSSIQ standard SOIC-8.
- SFP+ host pins, SFF-8431.

Ang BOM ay nasa `bom/BOM.csv`. Net summary ay nasa `bom/netlist-summary.txt`.

## Open in EasyEDA

1. EasyEDA Standard.
2. File, Open, EasyEDA Source.
3. Choose `easyeda/POE_SW_8x2G5_4xSFP.json`.

Footprints are empty on purpose. Update the footprint column from the library, then assign real footprints to the functional symbols (SoC, magnetics, ESD, TPS51200, PCA9546A). Do not replace the symbols during that update.

This is a reference schematic. Do not fabricate until the Realtek BGA is bound and the PoE layout is checked against the TPS23881 EVM.
