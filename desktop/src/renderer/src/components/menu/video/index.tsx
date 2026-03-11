import { ReactElement, useState } from 'react'
import { Popover, Tooltip } from 'antd'
import { MonitorIcon } from 'lucide-react'

import { Device } from './device'
import { Resolution } from './resolution'
import { Scale } from './scale'

export const Video = (): ReactElement => {
  const [open, setOpen] = useState(false)

  const content = (
    <div className="flex flex-col space-y-1">
      <Resolution />
      <Scale />
      <Device />
    </div>
  )

  return (
    <Popover
      content={content}
      placement="bottomLeft"
      trigger="click"
      arrow={false}
      open={open}
      onOpenChange={setOpen}
    >
      <Tooltip title="Video" placement="bottom" open={open ? false : undefined}>
        <div className="flex h-[28px] cursor-pointer items-center justify-center rounded px-2 text-white hover:bg-neutral-700/70">
          <MonitorIcon size={18} />
        </div>
      </Tooltip>
    </Popover>
  )
}