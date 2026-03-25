local LrApplication = import 'LrApplication'
local LrHttp = import 'LrHttp'
local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'

local exportFilterProvider = {}

exportFilterProvider.exportPresetFields = {
    { key = 'enabled', default = true }
}

function exportFilterProvider.sectionForFilterInDialog( f, propertyTable )
    return {
        title = "Social Media Central",
        f:row {
            f:static_text {
                title = "Images and metadata will be sent to the SMC app after export."
            }
        }
    }
end

function exportFilterProvider.postProcessRenderedPhotos(functionContext, filterContext)
    local imagePaths = {}
    local metadata = {}
    local firstPhoto = false

    -- 1. EXTRACT AND RENDER (Must run in the main thread)
    for sourceRendition, renditionToSatisfy in filterContext:renditions{ plugin = _PLUGIN } do
        if not firstPhoto then
            local photo = sourceRendition.photo
            if photo then
                local function getMeta(key)
                    local s, val = pcall(function() return photo:getFormattedMetadata(key) end)
                    if s and val then return tostring(val) else return "" end
                end
                
                metadata = {
                    title = getMeta('title'),
                    caption = getMeta('caption'),
                    keywords = getMeta('keywordTagsForExport'),
                    location = getMeta('location'),
                    camera = getMeta('cameraModel'),
                    lens = getMeta('lens'),
                    aperture = getMeta('aperture'),
                    iso = getMeta('isoSpeedRating')
                }
                firstPhoto = true
            end
        end

        local success, pathOrMessage = sourceRendition:waitForRender()
        if success then
            table.insert(imagePaths, pathOrMessage)
        end
    end

    -- 2. SEND PAYLOAD AND AUTO-LAUNCH (Runs in the background)
    if #imagePaths > 0 then
        local function escape(s)
            if not s then return "" end
            s = tostring(s)
            s = string.gsub(s, "\\", "\\\\")
            s = string.gsub(s, '"', '\\"')
            s = string.gsub(s, "\n", "\\n")
            s = string.gsub(s, "\r", "\\r")
            return s
        end

        local keywordsJson = "[]"
        if metadata.keywords and metadata.keywords ~= "" then
            local kwArray = {}
            for kw in string.gmatch(metadata.keywords, "[^,]+") do
                kw = string.match(kw, "^%s*(.-)%s*$")
                table.insert(kwArray, '"' .. escape(kw) .. '"')
            end
            keywordsJson = "[" .. table.concat(kwArray, ", ") .. "]"
        end

        local pathsJson = "["
        for i, p in ipairs(imagePaths) do
            pathsJson = pathsJson .. '"' .. escape(p) .. '"'
            if i < #imagePaths then pathsJson = pathsJson .. ", " end
        end
        pathsJson = pathsJson .. "]"

        local payload = '{' ..
            '"imagePaths": ' .. pathsJson .. ',' ..
            '"metadata": {' ..
                '"title": "' .. escape(metadata.title) .. '",' ..
                '"caption": "' .. escape(metadata.caption) .. '",' ..
                '"keywords": ' .. keywordsJson .. ',' ..
                '"location": "' .. escape(metadata.location) .. '",' ..
                '"camera": "' .. escape(metadata.camera) .. '",' ..
                '"lens": "' .. escape(metadata.lens) .. '",' ..
                '"aperture": "' .. escape(metadata.aperture) .. '",' ..
                '"iso": "' .. escape(metadata.iso) .. '"' ..
            '}' ..
        '}'

        local reqHeaders = { { field = 'Content-Type', value = 'application/json' } }
        
        -- Move the network request into an async task so we can safely sleep/wait for the app to open
        LrTasks.startAsyncTask(function()
            local response, networkError = LrHttp.post('http://localhost:49152/lightroom-export', payload, reqHeaders)
            
            -- If it fails, it means the app is closed. Auto-launch it.
            if not response then
                if MAC_ENV then
                    os.execute('open -a "Social Media Central"')
                elseif WIN_ENV then
                    os.execute('start "" "Social Media Central"')
                end

                -- Safely pause this background script for 5 seconds to give Electron time to boot
                LrTasks.sleep(5)

                -- Try sending the data one more time now that the app is open
                response, networkError = LrHttp.post('http://localhost:49152/lightroom-export', payload, reqHeaders)

                if not response then
                    LrDialogs.message("Auto-Launch Failed", "Tried to wake up Social Media Central, but it didn't respond in time.", "critical")
                end
            end
        end)
    end
end

return exportFilterProvider
