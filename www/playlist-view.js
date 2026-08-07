import Commands from './commands.js';
import MetaUtil from './meta-util.js';
import Model from './model.js';
import PlaylistContextMenu from './playlist-context-menu.js';
import PlaylistSavePanel from './playlist-save-panel.js';
import TrackListItemUtil from './track-list-item-util.js';
import PlaylistVo from './playlist-vo.js'
import Service from './service.js';
import Settings from './settings.js';
import Subview from './subview.js';
import Util from './util.js';
import Values from './values.js';
import ViewUtil from './view-util.js';

/**
 * Playlist view 'proper', containing list of tracks.
 */
export default class PlaylistView extends Subview {

  constructor($el) {
    super($el);

    this.selectedUri = null;
    this.selectedIndex = -1;
    this.dragStartIndex = -1;
    this.dragCurrentIndex = -1;
    this.$dragPlaceholder = null;

   	this.$list = this.$el.find("#playlistList");
    this.$repeatButton = this.$el.find('#playlistRepeatButton');
    this.$loadButton = this.$el.find('#playlistLoadButton');
    this.$saveButton = this.$el.find('#playlistSaveButton');

    this.savePanel = new PlaylistSavePanel(this.$el.find('#playlistSaver'));
    this.contextMenu = new PlaylistContextMenu();

    this.updateSelectedItem = () => {
      const uri = Model.status.metadata['@_uri'];
      this.selectItemByUri(uri);
    };
    this.updateRepeatButton = () => {
      if (Model.state.isRepeatAll) {
        this.$repeatButton.removeClass('isOne').addClass('isAll');
        this.$repeatButton.text('Repeat all');
      } else if (Model.state.isRepeatOne) {
        this.$repeatButton.removeClass('isAll').addClass('isOne');
        this.$repeatButton.text('Repeat track');
      } else {
        this.$repeatButton.removeClass('isAll isOne');
        this.$repeatButton.text('Repeat off');
      }
    };
    this.onItemClick = (event) => {
      const index = parseInt($(event.currentTarget).attr("data-index"));
      $(document).trigger('playbar-track-change-command', Commands.selectTrack(index + 1));
    };
    this.onDeleteButton = (event) => {
      event.stopPropagation();
      const $button = $(event.currentTarget);
      const $listItem = $button.parent().parent();
      const index = parseInt($listItem.attr('data-index'));
      if (!(index >= 0)) {
        cl('warning no index');
        return;
      }
      Service.queueCommandsFront([Commands.playlistRemove(index + 1), Commands.playlistGet()]);
    };
    this.onDragHandleDown = (event) => {
      event.stopPropagation();
      event.preventDefault();
      const $handle = $(event.currentTarget);
      const $listItem = $handle.parent().parent();
      const index = parseInt($listItem.attr('data-index'));
      if (!(index >= 0)) {
        cl('warning no index for drag');
        return;
      }
      this.dragStartIndex = index;
      this.dragCurrentIndex = index;
      this.$dragGhost = $listItem.clone();
      this.$dragGhost.addClass('playlistDragGhost');
      this.$dragGhost.css({
        position: 'fixed',
        left: event.clientX - 20,
        top: event.clientY - 20,
        zIndex: 10002,
        pointerEvents: 'none'
      });
      $('body').append(this.$dragGhost);
      if ($listItem.hasClass('trackItemAlbumHeader')) {
        const $trackItem = this.$list.find(`.trackItem[data-index="${index}"]:not(.trackItemAlbumHeader)`);
        $trackItem.addClass('isDragging');
        $trackItem.css('opacity', '0');
      }
      $listItem.addClass('isDragging');
      $listItem.css('opacity', '0');
      this.originalPositions = [];
      this.$list.find('.trackItem:not(.isDragging)').each((i, el) => {
        const rect = ViewUtil.getRect(el, (newRect) => {
          const obj = this.originalPositions.find(o => o.element === el);
          if (obj) obj.rect = newRect;
        });
        this.originalPositions.push({ element: el, rect: rect });
      });
      $(document).on('mousemove.playlistDrag', this.onDragMove);
      $(document).on('mouseup.playlistDrag', this.onDragEnd);
      $(document).on('touchmove.playlistDrag', this.onDragMove);
      $(document).on('touchend.playlistDrag touchcancel.playlistDrag', this.onDragEnd);
    };
    this.onDragMove = (event) => {
      const clientY = event.touches ? event.touches[0].clientY : event.clientY;
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      if (this.$dragGhost) {
        this.$dragGhost.css({
          left: clientX - 20,
          top: clientY - 20
        });
      }
      const $items = this.$list.find('.trackItem:not(.isDragging):not(.trackItemAlbumHeader)');
      let targetIndex = -1;
      $items.each((i, el) => {
        const rect = ViewUtil.getRect(el, (newRect) => {
        });
        const midY = rect.top + rect.height / 2;
        if (clientY < midY && targetIndex === -1) {
          targetIndex = i;
        }
      });
      if (targetIndex === -1) {
        targetIndex = $items.length;
      }
      if (Math.abs(targetIndex - this.dragCurrentIndex) >= 1) {
        this.dragCurrentIndex = targetIndex;
        this.updateTrackPositionsForDrag();
      }
    };
    this.onDragEnd = () => {
      $(document).off('.playlistDrag');
      if (this.$dragGhost) {
        this.$dragGhost.remove();
        this.$dragGhost = null;
      }
      const from = this.dragStartIndex;
      const to = this.dragCurrentIndex;
      if (from >= 0) {
        if (this.trackItems$ && this.trackItems$[from]) {
          const $originalItem = this.trackItems$[from];
          $originalItem.removeClass('isDragging');
          $originalItem.css('opacity', '1');
        }
        const $albumHeader = this.$list.find(`.trackItemAlbumHeader[data-index="${from}"]`);
        if ($albumHeader.length) {
          $albumHeader.removeClass('isDragging');
          $albumHeader.css('opacity', '1');
        }
      }
      this.$list.find('.trackItem').css({
        transform: 'translateY(0)',
        transition: 'transform 200ms ease-out'
      });
      this.dragStartIndex = -1;
      this.dragCurrentIndex = -1;
      if (!(from >= 0) || !(to >= 0) || from === to) {
        return;
      }
      const commands = [];
      if (to < from) {
        let idx = from + 1;
        const moves = from - to;
        for (let i = 0; i < moves; i++) {
          commands.push(Commands.playlistMoveUp(idx));
          idx--;
        }
      } else if (to > from) {
        let idx = from + 1;
        const moves = to - from;
        for (let i = 0; i < moves; i++) {
          commands.push(Commands.playlistMoveDown(idx));
          idx++;
        }
      }
      commands.push(Commands.playlistGet());
      if (commands.length > 1) {
        Service.queueCommandsFront(commands);
      }
    };
    this.onClearButton = () => {
      Service.queueCommandsFront([Commands.playlistClear(), Commands.playlistGet()]);
    };
    this.onRepeatButton = () => {
      let value;
      if (this.$repeatButton.hasClass('isAll')) {
        value = '1';
      } else if (this.$repeatButton.hasClass('isOne')) {
        value = '0';
      } else {
        value = '2';
      }
      Service.queueCommandsFront([Commands.setRepeat(value), Commands.state()]);
    };
    this.onSaveButton = () => {
      const b = ViewUtil.isDisplayed(this.savePanel.$el);
      this.showSavePanel(!b);
    };
    this.onNewTrack = (e, currentUri, lastUri) => {
      const currentIndex = this.playlist.getIndexByUri(currentUri);
      const lastIndex = this.playlist.getIndexByUri(lastUri);
      if (currentIndex > -1) {
        if (currentIndex > lastIndex) {
          const $item = this.trackItems$[currentIndex];
          Util.autoScrollListItem($item, this.$el);
        }
      }
    };

  	this.$el.find("#playlistCloseButton").on("click tap", () => $(document).trigger('playlist-close-button'));
		this.$el.find("#playlistClearButton").on("click tap", this.onClearButton);

    this.$loadButton.on("click tap", () => $(document).trigger('playlist-load-button'));
    this.$saveButton.on("click tap", this.onSaveButton);
    this.$repeatButton.on('click tap', this.onRepeatButton);

    Util.addAppListener(this, 'model-playlist-updated', this.populate);
    Util.addAppListener(this, 'model-library-updated', this.onModelLibraryUpdated);
    const f = TrackListItemUtil.makeTrackMetaChangeHandler(this.$list);
    $(document).on('meta-track-favorite-changed meta-track-incremented', f); // fyi, must persist
	}

  onShow() {
    this.$el[0].scrollTop = 0;
    ViewUtil.setVisible(this.$el, true);
    ViewUtil.setFocus(this.$el);
    $(document).on('model-status-updated', this.updateSelectedItem);
    $(document).on('model-state-updated', this.updateRepeatButton);
    $(document).on('new-track', this.onNewTrack);
    this.updateSaveButton();
    this.showSavePanel(false);

    Service.queueCommandFront(Commands.state());
  }

  onHide() {
    this.contextMenu.hide();
    $(document).off('model-status-updated', this.updateSelectedItem);
    $(document).off('model-state-updated', this.updateRepeatButton);
    $(document).off('new-track', this.onNewTrack);
  }

  populate() {
    this.selectedUri = null;
    this.selectedIndex = -1;

    this.updateRepeatButton();

    this.playlist = Model.playlist;
    this.updateSaveButton();
    this.trackItems$ = [];
		this.$list.empty();

    if (this.playlist.array.length == 0) {

      const $nonItem = $(`<div class="playHisNonItem">Playlist is empty</div>`);
      this.$list.append($nonItem);

    } else {

      this.trackItems$ = TrackListItemUtil.populateList(this.$list, this.playlist.array);

      for (const $item of this.trackItems$) {
          $item.on("click tap", this.onItemClick);
          $item.find(".deleteButton").on("click tap", this.onDeleteButton);
          $item.find(".dragHandleButton").on("mousedown touchstart", this.onDragHandleDown);
      }
      this.$list.find(".trackItemAlbumHeader.isSingleTrackAlbum .dragHandleButton").on("mousedown touchstart", this.onDragHandleDown);
    }

    this.updateSelectedItem();
	}

  selectItemByUri(uri=null) {
    if (uri == this.selectedUri) {
      return;
    }

    this.selectedUri = uri;
    const lastSelectedIndex = this.selectedIndex;
    this.selectedIndex = Model.playlist.getIndexByUri(this.selectedUri);
    if (this.selectedIndex == -1) {
      // can happen between stop and play states or smth
    }

    if (!this.trackItems$) {
      // can happen on startup somehow
      // console.trace();
      return;
    }

    for (let i = 0; i < this.trackItems$.length; i++) {
      const $item = this.trackItems$[i];
      if (i == this.selectedIndex) {
        $item.addClass("selected");
      } else {
        $item.removeClass("selected");
      }
    }
  }

  updateSaveButton() {
    const b = (this.playlist && this.playlist.array.length > 0);
    if (b) {
      this.$saveButton.removeClass('isDisabled')
    } else {
      this.$saveButton.addClass('isDisabled');
    }
  }

  showSavePanel(b) {
    if (b) {
      this.savePanel.show();
    } else {
      this.savePanel.hide();
    }
  }

  updateTrackPositionsForDrag() {
    if (this.dragStartIndex === -1 || this.dragCurrentIndex === -1) {
      return;
    }

    // Only move actual track items, not album headers
    const $items = this.$list.find('.trackItem:not(.isDragging):not(.trackItemAlbumHeader)');

    // Create a single gap at the target position
    $items.each((i, el) => {
      const $item = $(el);
      const itemIndex = i;
      const targetIndex = this.dragCurrentIndex;

      // Calculate the gap position considering the dragged item's removal
      let gapPosition = targetIndex;
      if (targetIndex > this.dragStartIndex) {
        // When dragging down, the dragged item is removed from earlier position,
        // so we need to adjust the gap position
        gapPosition = targetIndex;
      } else {
        // When dragging up, normal positioning
        gapPosition = targetIndex;
      }

      if (itemIndex >= gapPosition) {
        // Move items from gap position onwards down by one track height
        $item.css({
          transform: 'translateY(48px)',
          transition: 'transform 150ms ease-out'
        });
      } else {
        // Keep items before gap position in place
        $item.css({
          transform: 'translateY(0)',
          transition: 'transform 150ms ease-out'
        });
      }
    });
  }

  onModelLibraryUpdated() {
    this.populate();
  }

}
