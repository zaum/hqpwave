import ContextMenu from './context-menu.js';
import ViewUtil from './view-util.js';
import AlbumUtil from './album-util.js';
import Commands from './commands.js';
import Model from './model.js';
import Service from './service.js';
import AppUtil from './app-util.js';

/**
 *
 */
export default class AlbumContextMenu extends ContextMenu {

  album;
  index = -1;

  constructor($el) {
    super($el);

    this.$itemPlaylist = this.$el.find('#albumContextItemPlaylist');
    this.$itemPlaylistMultiple = this.$el.find('#albumContextItemPlaylistMultiple');
    this.$itemPlayNow = this.$el.find('#albumContextItemPlayNow');
    this.$itemPlayNowMultiple = this.$el.find('#albumContextItemPlayNowMultiple');
  }

  show($holder, $button, album, index) {
    super.show($holder, $button);

    this.album = album;
    this.index = index;

    // Update items' vis
    const lastTrackEndIndex = AlbumUtil.getTracksOf(this.album).length - 1;
    const isLastItem = (this.index == lastTrackEndIndex);
    ViewUtil.setDisplayed(this.$itemPlaylistMultiple, !isLastItem);
    ViewUtil.setDisplayed(this.$itemPlayNowMultiple, !isLastItem);
  }

  // override
  onItemClick(event) {
    super.onItemClick(event);
    const $item = $(event.currentTarget);

    const id = $item.attr('id');
    const lastTrackEndIndex = AlbumUtil.getTracksOf(this.album).length - 1;
    let isPlayNow;
    const startIndex = this.index;
    let endIndex;
    switch (id) {
      case 'albumContextItemPlaylist':
        endIndex = startIndex;
        isPlayNow = false;
        break;
      case 'albumContextItemPlaylistMultiple':
        endIndex = lastTrackEndIndex;
        isPlayNow = false;
        break;
      case 'albumContextItemPlayNow':
        endIndex = startIndex;
        isPlayNow = true;
        break;
      case 'albumContextItemPlayNowMultiple':
        endIndex = lastTrackEndIndex;
        isPlayNow = true;
        break;
      default:
        return;
    }
    const commands = Commands.playlistAddUsingAlbumAndIndices(this.album, startIndex, endIndex, isPlayNow);
    AppUtil.doPlaylistAdds(commands, isPlayNow, isPlayNow);
  }
}
