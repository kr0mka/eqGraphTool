# eqGraphTool

A frequency response visualization and parametric EQ tool for IEMs and headphones, with a focus on **RME TotalMix FX** integration.

**See it in action:** [kr0mka.squig.link](https://kr0mka.squig.link/)

## Key Features

### Interactive EQ
Visually create and adjust EQ filters directly on the frequency response graph:
- Click/tap on the graph to add filters
- Drag handles to adjust frequency and gain
- Scroll or drag whiskers to adjust Q
- Double-click to cycle filter types (Peak/Low Shelf/High Shelf)
- Real-time preview as you drag

### RME TotalMix FX Integration
- Export parametric EQ in RME-compatible format for direct paste into TotalMix FX
- RoomEQ compatible output
- TotalMix FX Read/Write EQ support through OSC (requires [totalmix-osc-bridge](https://github.com/kr0mka/totalmix-osc-bridge))

### Additional Features
- Preference curve adjustments (tilt, bass shelf, ear gain, treble)

## Adding Measurements

Place your frequency response `.txt` files in the `data/` directory. Files should be in REW or AudioTool format with frequency and dB columns.

Update `data/phone_book.json` with your measurement entries.

## Thanks

This project is built upon the work of several amazing projects and people:

- [CrinGraph](https://github.com/mlochbaum/CrinGraph) by Marshall Lochbaum
- [PublicGraphTool](https://github.com/HarutoHiroki/PublicGraphTool) by HarutoHiroki
- [ExtendedGraphTool](https://github.com/potatosalad775/ExtendedGraphTool) by potatosalad775
- [Listener](https://listener800.github.io/)

## License

MIT License - see [LICENSE](LICENSE) for details.
