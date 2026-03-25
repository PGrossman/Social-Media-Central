local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrHttp = import 'LrHttp'

local exportServiceProvider = {}

function exportServiceProvider.postProcessRenderedPhotos(functionContext, filterContext)
    local exportSession = filterContext.exportSession
    local imagePaths = {}
    local metadata = {}
    local firstPhotoProcessed = false

    -- Loop through the photos as they finish rendering (resizing/watermarking)
    for i, rendition in exportSession:renditions() do
        -- Wait for Lightroom to finish saving this specific JPG to the hard drive
        local success, pathOrMessage = rendition:waitForRender()
        
        if success then
            table.insert(imagePaths, pathOrMessage)

            -- We only need to grab the metadata once from the lead photo
            if not firstPhotoProcessed then
                local photo = rendition.photo
                metadata = {
                    title = photo:getFormattedMetadata('title') or "",
                    caption = photo:getFormattedMetadata('caption') or "",
                    keywords = photo:getFormattedMetadata('keywordTagsForExport') or "",
                    location = photo:getFormattedMetadata('location') or "",
                    camera = photo:getFormattedMetadata('cameraModel') or "",
                    lens = photo:getFormattedMetadata('lens') or "",
                    aperture = photo:getFormattedMetadata('aperture') or "",
                    iso = photo:getFormattedMetadata('isoSpeedRating') or ""
                }
                firstPhotoProcessed = true
            end
        end
    end

    -- If we successfully exported images, send the payload to the Electron App
    if #imagePaths > 0 then
        LrTasks.startAsyncTask(function()
            -- Helper function to safely escape JSON strings in Lua
            local function escapeJson(str)
                if str == nil then return "" end
                str = tostring(str)
                str = string.gsub(str, "\\", "\\\\")
                str = string.gsub(str, '"', '\\"')
                str = string.gsub(str, "\n", "\\n")
                str = string.gsub(str, "\r", "\\r")
                return str
            end

            -- Format keywords into a JSON array safely
            local keywordsJson = "[]"
            if metadata.keywords ~= "" then
                local kwArray = {}
                for kw in string.gmatch(metadata.keywords, "[^,]+") do
                    kw = string.match(kw, "^%s*(.-)%s*$") -- trim
                    table.insert(kwArray, '"' .. escapeJson(kw) .. '"')
                end
                keywordsJson = "[" .. table.concat(kwArray, ", ") .. "]"
            end

            -- Format file paths into a JSON array safely
            local pathsJsonArray = {}
            for _, p in ipairs(imagePaths) do
                table.insert(pathsJsonArray, '"' .. escapeJson(p) .. '"')
            end
            local pathsJson = "[" .. table.concat(pathsJsonArray, ", ") .. "]"

            -- Construct the raw JSON payload matching what Electron main.cjs expects
            local payload = string.format([[
            {
                "imagePaths": %s,
                "metadata": {
                    "title": "%s",
                    "caption": "%s",
                    "keywords": %s,
                    "location": "%s",
                    "camera": "%s",
                    "lens": "%s",
                    "aperture": "%s",
                    "iso": "%s"
                }
            }
            ]], 
            pathsJson, 
            escapeJson(metadata.title), 
            escapeJson(metadata.caption), 
            keywordsJson,
            escapeJson(metadata.location), 
            escapeJson(metadata.camera), 
            escapeJson(metadata.lens), 
            escapeJson(metadata.aperture), 
            escapeJson(metadata.iso))

            local headers = {
                { field = 'Content-Type', value = 'application/json' }
            }

            -- Fire and forget the POST request to our local Electron server
            LrHttp.post('http://127.0.0.1:49152/lightroom-export', payload, headers)
        end)
    end
end

return exportServiceProvider
